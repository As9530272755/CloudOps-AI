package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/cloudops/platform/internal/pkg/config"
	"github.com/cloudops/platform/internal/pkg/crypto"
	"github.com/cloudops/platform/internal/pkg/database"
	"github.com/cloudops/platform/internal/service"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func main() {
	configPath := os.Getenv("CONFIG_PATH")
	if configPath == "" {
		configPath = "config/config.yaml"
	}

	cfg, err := config.LoadConfig(configPath)
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}

	db, err := database.InitDB(cfg)
	if err != nil {
		log.Fatalf("数据库初始化失败: %v", err)
	}

	encryptor := crypto.NewAES256Encrypt(cfg.Security.JWT.Secret)
	k8sManager := service.NewK8sManager(db, encryptor)

	fmt.Println("正在连接集群: yh ...")
	if err := k8sManager.StartCluster(context.Background(), 2); err != nil {
		fmt.Printf("连接失败: %v\n", err)
		return
	}
	client := k8sManager.GetClient(2)
	if client == nil {
		fmt.Println("无法获取客户端")
		return
	}

	// 1. 检查 Fluent Bit ConfigMap
	fmt.Println("\n========== Fluent Bit 配置 ==========")
	cms, _ := client.CoreV1().ConfigMaps("").List(context.Background(), metav1.ListOptions{})
	for _, cm := range cms.Items {
		nameLower := strings.ToLower(cm.Name)
		if strings.Contains(nameLower, "fluent-bit") {
			fmt.Printf("\n[ConfigMap] %s/%s\n", cm.Namespace, cm.Name)
			for k, v := range cm.Data {
				fmt.Printf("--- 文件: %s ---\n", k)
				// 只输出关键配置行
				lines := strings.Split(v, "\n")
				for _, line := range lines {
					trimmed := strings.TrimSpace(line)
					if trimmed == "" || strings.HasPrefix(trimmed, "#") {
						continue
					}
					lower := strings.ToLower(trimmed)
					if strings.Contains(lower, "host") ||
						strings.Contains(lower, "match") ||
						strings.Contains(lower, "output") ||
						strings.Contains(lower, "es.") ||
						strings.Contains(lower, "loki") ||
						strings.Contains(lower, "kafka") ||
						strings.Contains(lower, "s3") ||
						strings.Contains(lower, "forward") ||
						strings.Contains(lower, "http") ||
						strings.Contains(lower, "service") ||
						strings.Contains(lower, "[output") ||
						strings.Contains(lower, "[input") {
						fmt.Println(trimmed)
					}
				}
			}
		}
	}

	// 2. 检查是否有其他日志存储后端（Deployment/StatefulSet）
	fmt.Println("\n========== 可能的日志存储后端 ==========")
	keywords := []string{"elasticsearch", "loki", "kafka", "clickhouse", "victorialogs", "minio"}
	found := false
	deps, _ := client.AppsV1().Deployments("").List(context.Background(), metav1.ListOptions{})
	for _, d := range deps.Items {
		nameLower := strings.ToLower(d.Name)
		for _, kw := range keywords {
			if strings.Contains(nameLower, kw) {
				fmt.Printf("[Deployment] %s/%s (replicas: %d)\n", d.Namespace, d.Name, *d.Spec.Replicas)
				found = true
			}
		}
	}
	sts, _ := client.AppsV1().StatefulSets("").List(context.Background(), metav1.ListOptions{})
	for _, s := range sts.Items {
		nameLower := strings.ToLower(s.Name)
		for _, kw := range keywords {
			if strings.Contains(nameLower, kw) {
				fmt.Printf("[StatefulSet] %s/%s (replicas: %d)\n", s.Namespace, s.Name, *s.Spec.Replicas)
				found = true
			}
		}
	}
	if !found {
		fmt.Println("未发现 ES / Loki / Kafka / ClickHouse / MinIO 等存储后端 Deployment/StatefulSet")
	}

	// 3. 检查 Services 中是否有日志相关的端口暴露
	fmt.Println("\n========== 日志相关 Service ==========")
	svcs, _ := client.CoreV1().Services("").List(context.Background(), metav1.ListOptions{})
	foundSvc := false
	for _, svc := range svcs.Items {
		nameLower := strings.ToLower(svc.Name)
		for _, kw := range append(keywords, "fluent-bit", "grafana") {
			if strings.Contains(nameLower, kw) {
				fmt.Printf("[Service] %s/%s:%d ClusterIP=%s\n", svc.Namespace, svc.Name, svc.Spec.Ports[0].Port, svc.Spec.ClusterIP)
				foundSvc = true
				break
			}
		}
	}
	if !foundSvc {
		fmt.Println("未发现明显日志存储相关的 Service")
	}

	// 4. 检查 Pod 日志路径（判断是否是 containerd/docker 标准输出模式）
	fmt.Println("\n========== 容器运行时信息 ==========")
	nodes, _ := client.CoreV1().Nodes().List(context.Background(), metav1.ListOptions{})
	if len(nodes.Items) > 0 {
		fmt.Printf("集群节点数: %d\n", len(nodes.Items))
		for _, n := range nodes.Items {
			fmt.Printf("Node: %s\n", n.Name)
		}
	}

	// 5. 查看 fluent-bit pod 的实际容器镜像和启动命令（可能暴露后端地址）
	fmt.Println("\n========== Fluent Bit Pod 详情 ==========")
	pods, _ := client.CoreV1().Pods("tools").List(context.Background(), metav1.ListOptions{LabelSelector: "app.kubernetes.io/name=fluent-bit"})
	if len(pods.Items) == 0 {
		// 尝试无 label selector
		pods, _ = client.CoreV1().Pods("tools").List(context.Background(), metav1.ListOptions{})
	}
	for _, pod := range pods.Items {
		if len(pod.Spec.Containers) > 0 {
			c := pod.Spec.Containers[0]
			fmt.Printf("Pod: %s, Image: %s\n", pod.Name, c.Image)
			for _, arg := range c.Args {
				fmt.Printf("  Arg: %s\n", arg)
			}
			for _, env := range c.Env {
				if strings.Contains(strings.ToLower(env.Name), "host") || strings.Contains(strings.ToLower(env.Name), "url") || strings.Contains(strings.ToLower(env.Name), "endpoint") {
					val := env.Value
					if val == "" && env.ValueFrom != nil {
						val = "<来自Secret/ConfigMap>"
					}
					fmt.Printf("  Env: %s=%s\n", env.Name, val)
				}
			}
			for _, vol := range c.VolumeMounts {
				fmt.Printf("  VolumeMount: %s -> %s\n", vol.Name, vol.MountPath)
			}
		}
	}

	// 6. 查看 kube-system 中 coredns 详情
	fmt.Println("\n========== CoreDNS 详情 ==========")
	cdnsPods, _ := client.CoreV1().Pods("kube-system").List(context.Background(), metav1.ListOptions{LabelSelector: "k8s-app=kube-dns"})
	for _, pod := range cdnsPods.Items {
		fmt.Printf("CoreDNS Pod: %s, Status: %s\n", pod.Name, pod.Status.Phase)
	}
	// 查看 coredns configmap（是否有 log 插件）
	cm, err := client.CoreV1().ConfigMaps("kube-system").Get(context.Background(), "coredns", metav1.GetOptions{})
	if err == nil {
		fmt.Println("\nCoreDNS Corefile:")
		corefile := cm.Data["Corefile"]
		lines := strings.Split(corefile, "\n")
		for _, line := range lines {
			trimmed := strings.TrimSpace(line)
			if trimmed != "" {
				fmt.Println(trimmed)
			}
		}
		if strings.Contains(corefile, "log") {
			fmt.Println("\n✅ CoreDNS 已启用 log 插件")
		} else {
			fmt.Println("\n⚠️ CoreDNS 未显式启用 log 插件（默认可能通过 errors 输出）")
		}
	}

	// 7. 查看 ingress-nginx 的日志配置
	fmt.Println("\n========== Ingress Nginx 日志配置 ==========")
	ingCm, err := client.CoreV1().ConfigMaps("ingress-nginx").Get(context.Background(), "ingress-nginx-controller", metav1.GetOptions{})
	if err == nil {
		for k, v := range ingCm.Data {
			if strings.Contains(strings.ToLower(k), "log") {
				fmt.Printf("%s: %s\n", k, v)
			}
		}
	} else {
		fmt.Printf("获取 ingress-nginx ConfigMap 失败: %v\n", err)
	}

	_ = corev1.PodLogOptions{}
}
