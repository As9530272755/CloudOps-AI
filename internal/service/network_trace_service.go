package service

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/cloudops/platform/internal/pkg/config"
	"github.com/google/gopacket"
	"github.com/google/gopacket/layers"
	"github.com/google/gopacket/pcapgo"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"gorm.io/gorm"
	"github.com/cloudops/platform/internal/model"
)

// NetworkTraceSettings 网络追踪运行时可配置项
type NetworkTraceSettings struct {
	DebugImage string `json:"debug_image"`
}

// TopologyNode 拓扑节点
type TopologyNode struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Namespace  string `json:"namespace,omitempty"`
	Node       string `json:"node,omitempty"`
	Type       string `json:"type"`
	SymbolSize int    `json:"symbolSize,omitempty"`
}

// TopologyEdge 拓扑边
type TopologyEdge struct {
	Source      string  `json:"source"`
	Target      string  `json:"target"`
	Protocol    string  `json:"protocol"`
	Port        int32   `json:"port"`
	Bytes       int     `json:"bytes"`
	Requests    int     `json:"requests"`
	LatencyP95  float64 `json:"latencyP95"`
	SuccessRate float64 `json:"successRate"`
	LineWidth   int     `json:"lineWidth,omitempty"`
}

// TopologyData 拓扑数据
type TopologyData struct {
	Target TopologyNode   `json:"target"`
	Nodes  []TopologyNode `json:"nodes"`
	Edges  []TopologyEdge `json:"edges"`
}

// FlowItem 流量明细项
type FlowItem struct {
	SourcePod       string  `json:"sourcePod"`
	SourceNamespace string  `json:"sourceNamespace"`
	SourceNode      string  `json:"sourceNode,omitempty"`
	Protocol        string  `json:"protocol"`
	Port            int32   `json:"port"`
	Requests        int     `json:"requests"`
	Bytes           int     `json:"bytes"`
	LatencyP95      float64 `json:"latencyP95"`
	SuccessRate     float64 `json:"successRate"`
	LastActive      string  `json:"lastActive"`
}

// NetworkTraceService 网络追踪服务
type NetworkTraceService struct {
	mu        sync.RWMutex
	cfg       *config.Config
	settings  NetworkTraceSettings
	filePath  string
	k8sMgr    *K8sManager
	dsService *DatasourceService
	db        *gorm.DB
}

// NewNetworkTraceService 创建服务
func NewNetworkTraceService(cfg *config.Config, k8sMgr *K8sManager, dsService *DatasourceService, db *gorm.DB) *NetworkTraceService {
	s := &NetworkTraceService{
		cfg:       cfg,
		filePath:  "data/network_trace_settings.json",
		k8sMgr:    k8sMgr,
		dsService: dsService,
		db:        db,
		settings: NetworkTraceSettings{
			DebugImage: cfg.NetworkTrace.DebugImage,
		},
	}
	_ = s.load()
	return s
}

func (s *NetworkTraceService) load() error {
	b, err := os.ReadFile(s.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	return json.Unmarshal(b, &s.settings)
}

func (s *NetworkTraceService) save() error {
	_ = os.MkdirAll("data", 0755)
	b, err := json.MarshalIndent(s.settings, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.filePath, b, 0644)
}

// GetSettings 获取配置
func (s *NetworkTraceService) GetSettings() NetworkTraceSettings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.settings
}

// UpdateSettings 更新配置
func (s *NetworkTraceService) UpdateSettings(st NetworkTraceSettings) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if st.DebugImage == "" {
		st.DebugImage = s.cfg.NetworkTrace.DebugImage
	}
	s.settings = st
	return s.save()
}

// ==================== 拓扑构建 ====================

// BuildTopology 构建目标 Pod 的真实 K8s 逻辑拓扑
func (s *NetworkTraceService) BuildTopology(clusterID uint, namespace, podName string) (*TopologyData, error) {
	cc := s.k8sMgr.GetClusterClient(clusterID)
	if cc == nil {
		return nil, fmt.Errorf("集群 %d 未连接", clusterID)
	}

	// 1. 获取目标 Pod（优先从 cache，失败则 live get fallback）
	var targetPod *corev1.Pod
	targetObj, exists, err := cc.PodStore.GetByKey(namespace + "/" + podName)
	if err == nil && exists {
		targetPod = targetObj.(*corev1.Pod)
	} else {
		livePod, getErr := cc.Client.CoreV1().Pods(namespace).Get(context.Background(), podName, metav1.GetOptions{})
		if getErr != nil {
			return nil, fmt.Errorf("Pod %s/%s 不存在", namespace, podName)
		}
		targetPod = livePod
	}

	result := &TopologyData{
		Target: TopologyNode{
			ID:         fmt.Sprintf("pod:%s/%s", namespace, podName),
			Name:       podName,
			Namespace:  namespace,
			Node:       targetPod.Spec.NodeName,
			Type:       "target",
			SymbolSize: 90,
		},
		Nodes: []TopologyNode{},
		Edges: []TopologyEdge{},
	}

	nodeMap := make(map[string]bool)
	edgeMap := make(map[string]bool)

	addNode := func(n TopologyNode) {
		if nodeMap[n.ID] {
			return
		}
		nodeMap[n.ID] = true
		result.Nodes = append(result.Nodes, n)
	}

	addEdge := func(e TopologyEdge) {
		key := e.Source + "->" + e.Target
		if edgeMap[key] {
			return
		}
		edgeMap[key] = true
		result.Edges = append(result.Edges, e)
	}

	// 2. 查找所有 Service 并找出匹配 target Pod 的 Services
	matchedServices := make([]*corev1.Service, 0)
	for _, svcObj := range cc.ServiceStore.List() {
		svc := svcObj.(*corev1.Service)
		if svc.Namespace != namespace {
			continue
		}
		if selectorMatches(svc.Spec.Selector, targetPod.Labels) {
			matchedServices = append(matchedServices, svc)
		}
	}

	// 3. 添加 matched Services 和 Ingress -> Service 的边
	for _, svc := range matchedServices {
		svcNodeID := fmt.Sprintf("svc:%s/%s", svc.Namespace, svc.Name)
		addNode(TopologyNode{
			ID:         svcNodeID,
			Name:       svc.Name,
			Namespace:  svc.Namespace,
			Type:       "service",
			SymbolSize: 42,
		})

		port := int32(80)
		protocol := "TCP"
		if len(svc.Spec.Ports) > 0 {
			port = svc.Spec.Ports[0].Port
			protocol = inferProtocolByPortName(svc.Spec.Ports[0].Name)
		}
		// Service -> target Pod
		addEdge(TopologyEdge{
			Source:      svcNodeID,
			Target:      result.Target.ID,
			Protocol:    protocol,
			Port:        port,
			Bytes:       0,
			Requests:    0,
			LatencyP95:  0,
			SuccessRate: 100,
		})

		// 查找 Ingress -> Service
		for _, ingObj := range cc.IngressStore.List() {
			ing := ingObj.(*networkingv1.Ingress)
			if ing.Namespace != svc.Namespace {
				continue
			}
			if ingressPointsToService(ing, svc.Name) {
				ingNodeID := fmt.Sprintf("ing:%s/%s", ing.Namespace, ing.Name)
				addNode(TopologyNode{
					ID:         ingNodeID,
					Name:       ing.Name,
					Namespace:  ing.Namespace,
					Type:       "ingress",
					SymbolSize: 38,
				})
				// Ingress -> Service
				addEdge(TopologyEdge{
					Source:      ingNodeID,
					Target:      svcNodeID,
					Protocol:    "HTTP",
					Port:        80,
					Bytes:       0,
					Requests:    0,
					LatencyP95:  0,
					SuccessRate: 100,
				})
			}
		}
	}

	// 4. 通过 Endpoints 查找同 Service 的其他 Pods（兄弟 Pod）
	for _, svc := range matchedServices {
		key := svc.Namespace + "/" + svc.Name
		epObj, epExists, _ := cc.EndpointStore.GetByKey(key)
		if !epExists {
			continue
		}
		ep := epObj.(*corev1.Endpoints)
		for _, subset := range ep.Subsets {
			for _, addr := range subset.Addresses {
				if addr.TargetRef != nil && addr.TargetRef.Kind == "Pod" && addr.TargetRef.Name != podName {
					peerNodeID := fmt.Sprintf("pod:%s/%s", svc.Namespace, addr.TargetRef.Name)
					addNode(TopologyNode{
						ID:         peerNodeID,
						Name:       addr.TargetRef.Name,
						Namespace:  svc.Namespace,
						Type:       "pod",
						SymbolSize: 30,
					})
					// peer -> Service (和 target Pod 共享 Service)
					svcNodeID := fmt.Sprintf("svc:%s/%s", svc.Namespace, svc.Name)
					port := int32(80)
					protocol := "TCP"
					if len(subset.Ports) > 0 {
						port = subset.Ports[0].Port
						protocol = inferProtocolByPortName(subset.Ports[0].Name)
					}
					addEdge(TopologyEdge{
						Source:      peerNodeID,
						Target:      svcNodeID,
						Protocol:    protocol,
						Port:        port,
						Bytes:       0,
						Requests:    0,
						LatencyP95:  0,
						SuccessRate: 100,
					})
				}
			}
		}
	}

	// 5. 推断下游：从 Pod 环境变量和 namespace 内的其他 Services
	downstreamServices := findDownstreamServices(targetPod, cc)
	for _, svc := range downstreamServices {
		svcNodeID := fmt.Sprintf("svc:%s/%s", svc.Namespace, svc.Name)
		addNode(TopologyNode{
			ID:         svcNodeID,
			Name:       svc.Name,
			Namespace:  svc.Namespace,
			Type:       svcTypeByName(svc.Name),
			SymbolSize: 38,
		})
		port := int32(80)
		protocol := "TCP"
		if len(svc.Spec.Ports) > 0 {
			port = svc.Spec.Ports[0].Port
			protocol = inferProtocolByPortName(svc.Spec.Ports[0].Name)
		}
		addEdge(TopologyEdge{
			Source:      result.Target.ID,
			Target:      svcNodeID,
			Protocol:    protocol,
			Port:        port,
			Bytes:       0,
			Requests:    0,
			LatencyP95:  0,
			SuccessRate: 100,
		})
	}

	return result, nil
}

func selectorMatches(selector, labels map[string]string) bool {
	if len(selector) == 0 {
		return false
	}
	for k, v := range selector {
		if labels[k] != v {
			return false
		}
	}
	return true
}

func ingressPointsToService(ing *networkingv1.Ingress, svcName string) bool {
	for _, rule := range ing.Spec.Rules {
		if rule.HTTP == nil {
			continue
		}
		for _, path := range rule.HTTP.Paths {
			if path.Backend.Service != nil && path.Backend.Service.Name == svcName {
				return true
			}
		}
	}
	// default backend
	if ing.Spec.DefaultBackend != nil && ing.Spec.DefaultBackend.Service != nil && ing.Spec.DefaultBackend.Service.Name == svcName {
		return true
	}
	return false
}

func findDownstreamServices(pod *corev1.Pod, cc *ClusterClient) []*corev1.Service {
	result := make([]*corev1.Service, 0)
	ns := pod.Namespace

	// 收集 Pod 环境变量中引用的 host
	envHosts := make(map[string]bool)
	for _, c := range pod.Spec.Containers {
		for _, env := range c.Env {
			if strings.Contains(env.Name, "HOST") || strings.Contains(env.Name, "URL") || strings.Contains(env.Name, "ADDR") {
				if env.Value != "" {
					envHosts[strings.ToLower(env.Value)] = true
				}
			}
		}
	}

	// 遍历 namespace 内所有 Service，匹配环境变量或数据库特征名
	for _, svcObj := range cc.ServiceStore.List() {
		svc := svcObj.(*corev1.Service)
		if svc.Namespace != ns {
			continue
		}
		// 跳过 pod 自身已匹配的 service
		if selectorMatches(svc.Spec.Selector, pod.Labels) {
			continue
		}
		// 匹配数据库特征名
		lowerName := strings.ToLower(svc.Name)
		if strings.Contains(lowerName, "redis") || strings.Contains(lowerName, "mysql") ||
			strings.Contains(lowerName, "postgres") || strings.Contains(lowerName, "mongo") ||
			strings.Contains(lowerName, "kafka") || strings.Contains(lowerName, "rabbit") ||
			strings.Contains(lowerName, "elasticsearch") || strings.Contains(lowerName, "db") {
			result = append(result, svc)
			continue
		}
		// 匹配环境变量
		for host := range envHosts {
			if strings.Contains(host, lowerName) {
				result = append(result, svc)
				break
			}
		}
	}
	return result
}

func svcTypeByName(name string) string {
	lower := strings.ToLower(name)
	if strings.Contains(lower, "redis") || strings.Contains(lower, "mysql") ||
		strings.Contains(lower, "postgres") || strings.Contains(lower, "mongo") ||
		strings.Contains(lower, "db") {
		return "database"
	}
	if strings.Contains(lower, "kafka") || strings.Contains(lower, "rabbit") ||
		strings.Contains(lower, "mq") {
		return "service"
	}
	return "service"
}

func inferProtocolByPortName(portName string) string {
	lower := strings.ToLower(portName)
	switch {
		case strings.Contains(lower, "http"):
			return "HTTP"
		case strings.Contains(lower, "grpc"):
			return "gRPC"
		case strings.Contains(lower, "redis"):
			return "Redis"
		case strings.Contains(lower, "mysql"):
			return "MySQL"
		case strings.Contains(lower, "postgres"):
			return "PostgreSQL"
		case strings.Contains(lower, "mongo"):
			return "MongoDB"
		default:
			return "TCP"
	}
}

// ==================== 调试 / 抓包 ====================

// CreateEphemeralDebug 为目标 Pod 创建 Ephemeral Container
func (s *NetworkTraceService) CreateEphemeralDebug(ctx context.Context, clusterID uint, namespace, pod, image, command string) error {
	client := s.k8sMgr.GetClient(clusterID)
	if client == nil {
		return fmt.Errorf("集群 %d 未连接", clusterID)
	}
	if image == "" {
		image = s.GetSettings().DebugImage
	}
	if command == "" {
		command = "tcpdump -i any -nn -U -w /tmp/capture.pcap & TPID=$!; while kill -0 $TPID 2>/dev/null; do sleep 10; echo '===PCAP_BEGIN==='; base64 /tmp/capture.pcap | tr -d '\\n'; echo ''; echo '===PCAP_END==='; done; echo 'capture stopped'"
	}

	patchObj := map[string]interface{}{
		"spec": map[string]interface{}{
			"ephemeralContainers": []map[string]interface{}{
				{
					"name":    "netshoot",
					"image":   image,
					"command": []string{"sh", "-c", command},
					"securityContext": map[string]interface{}{
						"capabilities": map[string]interface{}{
							"add": []string{"NET_RAW", "NET_ADMIN"},
						},
					},
				},
			},
		},
	}
	patchBytes, err := json.Marshal(patchObj)
	if err != nil {
		return fmt.Errorf("marshal patch failed: %w", err)
	}

	_, err = client.CoreV1().Pods(namespace).Patch(
		ctx,
		pod,
		types.StrategicMergePatchType,
		patchBytes,
		metav1.PatchOptions{},
		"ephemeralcontainers",
	)
	if err != nil {
		msg := err.Error()
		// 如果 netshoot 已经存在，视为成功
		if strings.Contains(msg, "Duplicate value") && strings.Contains(msg, "netshoot") {
			return nil
		}
		// Pod 不支持临时容器（已终止、Job 完成、节点不支持等）
		if strings.Contains(msg, "is not valid for pod") || strings.Contains(msg, "ephemeralContainers") && strings.Contains(msg, "Forbidden") {
			return fmt.Errorf("该 Pod 当前状态不支持注入临时容器，可能原因：Pod 已终止、为单次 Job 或所在节点不支持 EphemeralContainers")
		}
		if strings.Contains(msg, "container runtime") || strings.Contains(msg, "runtime") {
			return fmt.Errorf("该节点容器运行时不支持临时容器，请确认 kubelet 已开启 EphemeralContainers 特性")
		}
		return err
	}
	return nil
}

// GetDebugLogs 获取 ephemeral container 的日志
func (s *NetworkTraceService) GetDebugLogs(ctx context.Context, clusterID uint, namespace, pod string) (string, error) {
	client := s.k8sMgr.GetClient(clusterID)
	if client == nil {
		return "", fmt.Errorf("集群 %d 未连接", clusterID)
	}

	req := client.CoreV1().Pods(namespace).GetLogs(pod, &corev1.PodLogOptions{
		Container: "netshoot",
		TailLines: int64Ptr(5000),
	})
	stream, err := req.Stream(ctx)
	if err != nil {
		// 容器尚未启动、不存在或 Pod 正在重建时，返回友好提示而非错误
		msg := err.Error()
		if strings.Contains(msg, "ContainerCreating") {
			return "netshoot 容器正在创建中，请稍等 5-10 秒后刷新", nil
		}
		if strings.Contains(msg, "not found") || strings.Contains(msg, "does not exist") || strings.Contains(msg, "is waiting to start") {
			return "netshoot 容器尚未就绪，请确认已点击「一键抓包」并等待容器启动", nil
		}
		if strings.Contains(msg, "is not valid for pod") {
			return "该 Pod 当前状态不支持查看抓包日志（Pod 可能已终止或为单次 Job）", nil
		}
		return "", err
	}
	defer stream.Close()

	b, err := io.ReadAll(stream)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// GetDebugPcap 从 ephemeral container 日志中解析 base64 编码的 pcap 数据
func (s *NetworkTraceService) GetDebugPcap(ctx context.Context, clusterID uint, namespace, pod string) ([]byte, error) {
	logs, err := s.GetDebugLogs(ctx, clusterID, namespace, pod)
	if err != nil {
		return nil, err
	}

	lines := strings.Split(logs, "\n")
	var b64 string
	for i := len(lines) - 1; i >= 2; i-- {
		if strings.TrimSpace(lines[i]) == "===PCAP_END===" && strings.TrimSpace(lines[i-2]) == "===PCAP_BEGIN===" {
			b64 = strings.TrimSpace(lines[i-1])
			break
		}
	}
	if b64 == "" {
		return nil, fmt.Errorf("抓包数据尚未就绪，请确认已点击「一键抓包」并等待 10 秒后刷新")
	}

	return base64.StdEncoding.DecodeString(b64)
}

// ParsePcapToFlowItems 解析 pcap 数据为流量明细
func (s *NetworkTraceService) ParsePcapToFlowItems(clusterID uint, namespace, podName string, pcapData []byte) ([]FlowItem, error) {
	cc := s.k8sMgr.GetClusterClient(clusterID)
	if cc == nil {
		return nil, fmt.Errorf("集群 %d 未连接", clusterID)
	}

	var targetIP string
	for _, obj := range cc.PodStore.List() {
		p := obj.(*corev1.Pod)
		if p.Namespace == namespace && p.Name == podName {
			targetIP = p.Status.PodIP
			if targetIP == "" {
				return nil, fmt.Errorf("目标 Pod 尚未分配 IP")
			}
			break
		}
	}
	if targetIP == "" {
		return nil, fmt.Errorf("未找到目标 Pod")
	}

	type agg struct {
		packetCount int
		byteCount   int
	}
	aggregates := make(map[string]*agg)

	r, err := pcapgo.NewReader(bytes.NewReader(pcapData))
	if err != nil {
		return nil, fmt.Errorf("解析 pcap 失败: %w", err)
	}

	for {
		data, ci, err := r.ReadPacketData()
		if err == io.EOF {
			break
		}
		if err != nil {
			continue
		}

		packet := gopacket.NewPacket(data, r.LinkType(), gopacket.Default)
		nl := packet.NetworkLayer()
		if nl == nil {
			continue
		}

		var srcIP, dstIP string
		switch ip := nl.(type) {
		case *layers.IPv4:
			srcIP, dstIP = ip.SrcIP.String(), ip.DstIP.String()
		case *layers.IPv6:
			srcIP, dstIP = ip.SrcIP.String(), ip.DstIP.String()
		default:
			continue
		}

		if srcIP != targetIP && dstIP != targetIP {
			continue
		}

		var sport, dport uint16
		var proto string

		if tcp := packet.Layer(layers.LayerTypeTCP); tcp != nil {
			t := tcp.(*layers.TCP)
			sport, dport = uint16(t.SrcPort), uint16(t.DstPort)
			proto = "TCP"
		} else if udp := packet.Layer(layers.LayerTypeUDP); udp != nil {
			u := udp.(*layers.UDP)
			sport, dport = uint16(u.SrcPort), uint16(u.DstPort)
			proto = "UDP"
		} else {
			proto = "IP"
		}

		var remoteIP, remotePortStr, targetPortStr string
		if srcIP == targetIP {
			remoteIP, remotePortStr = dstIP, strconv.Itoa(int(dport))
			targetPortStr = strconv.Itoa(int(sport))
		} else {
			remoteIP, remotePortStr = srcIP, strconv.Itoa(int(sport))
			targetPortStr = strconv.Itoa(int(dport))
		}
		key := fmt.Sprintf("%s:%s|%s|%s", remoteIP, remotePortStr, targetPortStr, proto)

		if aggregates[key] == nil {
			aggregates[key] = &agg{}
		}
		aggregates[key].packetCount++
		aggregates[key].byteCount += ci.CaptureLength
	}

	var result []FlowItem
	for k, v := range aggregates {
		parts := strings.SplitN(k, "|", 3)
		endpoint := parts[0]
		lastColon := strings.LastIndex(endpoint, ":")
		remoteIP := endpoint
		if lastColon > 0 {
			remoteIP = endpoint[:lastColon]
		}

		targetPort, _ := strconv.Atoi(parts[1])
		proto := parts[2]

		nsRemote, podRemote, _ := s.ResolveIPToPod(clusterID, remoteIP)

		sourcePod := podRemote
		sourceNS := nsRemote
		if sourcePod == "" {
			sourcePod = remoteIP
			sourceNS = "-"
		}

		sourceNode := ""
		for _, obj := range cc.PodStore.List() {
			p := obj.(*corev1.Pod)
			if p.Namespace == sourceNS && p.Name == podRemote {
				sourceNode = p.Spec.NodeName
				break
			}
		}

		result = append(result, FlowItem{
			SourcePod:       sourcePod,
			SourceNamespace: sourceNS,
			SourceNode:      sourceNode,
			Protocol:        proto,
			Port:            int32(targetPort),
			Requests:        v.packetCount,
			Bytes:           v.byteCount,
			LatencyP95:      0,
			SuccessRate:     100,
			LastActive:      "抓包窗口内",
		})
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].Bytes > result[j].Bytes
	})

	return result, nil
}

// ParseTcpdumpSummary 解析 tcpdump 文本输出，生成拓扑边
func (s *NetworkTraceService) ParseTcpdumpSummary(raw string) ([]TopologyEdge, error) {
	edges := make([]TopologyEdge, 0)
	// 只解析简单的 "IP src > dst: Flags" 格式
	scanner := bufio.NewScanner(strings.NewReader(raw))
	for scanner.Scan() {
		line := scanner.Text()
		// 示例: "IP 10.244.1.5.8080 > 10.244.1.6.12345: Flags [S], seq 0, win 29200, options [mss 1460,sackOK,TS val 123 ecr 0,nop,wscale 7], length 0"
		// 我们只需提取 srcIP:port > dstIP:port
		if !strings.HasPrefix(line, "IP ") {
			continue
		}
		parts := strings.SplitN(line[3:], ":", 2)
		if len(parts) < 2 {
			continue
		}
		flowPart := strings.TrimSpace(parts[0])
		// flowPart: "10.244.1.5.8080 > 10.244.1.6.12345"
		arrowParts := strings.Split(flowPart, " > ")
		if len(arrowParts) != 2 {
			continue
		}
		src := strings.TrimSpace(arrowParts[0])
		dst := strings.TrimSpace(arrowParts[1])
		// 去掉端口
		srcIP := stripPort(src)
		dstIP := stripPort(dst)
		if srcIP == "" || dstIP == "" {
			continue
		}
		edges = append(edges, TopologyEdge{
			Source:      srcIP,
			Target:      dstIP,
			Protocol:    "TCP",
			Port:        0,
			Bytes:       0,
			Requests:    1,
			LatencyP95:  0,
			SuccessRate: 100,
		})
	}
	return edges, scanner.Err()
}

// ResolveIPToPod 将集群中的 IP 解析为 Pod 名称
func (s *NetworkTraceService) ResolveIPToPod(clusterID uint, ip string) (namespace, pod string, err error) {
	cc := s.k8sMgr.GetClusterClient(clusterID)
	if cc == nil {
		return "", "", fmt.Errorf("集群 %d 未连接", clusterID)
	}
	for _, podObj := range cc.PodStore.List() {
		p := podObj.(*corev1.Pod)
		if p.Status.PodIP == ip {
			return p.Namespace, p.Name, nil
		}
	}
	return "", "", fmt.Errorf("未找到 IP %s 对应的 Pod", ip)
}

// getDefaultPrometheusDS 获取默认 Prometheus 数据源（无默认时取第一个活跃源）
func (s *NetworkTraceService) getDefaultPrometheusDS(ctx context.Context) (*model.DataSource, error) {
	var ds model.DataSource
	// 先尝试默认数据源
	if err := s.db.WithContext(ctx).Where("type = ? AND is_default = ? AND is_active = ?", "prometheus", true, true).First(&ds).Error; err != nil {
		// 无默认时取第一个活跃的 Prometheus 源
		if err := s.db.WithContext(ctx).Where("type = ? AND is_active = ?", "prometheus", true).Order("id ASC").First(&ds).Error; err != nil {
			return nil, fmt.Errorf("未找到可用的 Prometheus 数据源")
		}
	}
	return &ds, nil
}

// queryPromQLScalar 执行 PromQL 查询并返回标量
func (s *NetworkTraceService) queryPromQLScalar(ctx context.Context, ds *model.DataSource, query string) float64 {
	resp, err := s.dsService.ProxyPrometheusQuery(ctx, ds, &ProxyQueryRequest{Query: query})
	if err != nil || resp == nil || resp.Status != "success" || resp.Data == nil {
		return 0
	}
	result, ok := resp.Data.(map[string]interface{})
	if !ok {
		return 0
	}
	resultType, _ := result["resultType"].(string)
	results, _ := result["result"].([]interface{})
	if len(results) == 0 {
		return 0
	}
	if resultType == "vector" {
		item := results[0].(map[string]interface{})
		value := item["value"].([]interface{})
		if len(value) >= 2 {
			v, _ := strconv.ParseFloat(value[1].(string), 64)
			return v
		}
	}
	if resultType == "scalar" {
		scalar := results[0].([]interface{})
		v, _ := strconv.ParseFloat(scalar[1].(string), 64)
		return v
	}
	return 0
}

// GetPodTrafficMetrics 从 Prometheus 获取 Pod 聚合网络流量
func (s *NetworkTraceService) GetPodTrafficMetrics(ctx context.Context, namespace, pod string) (map[string]float64, error) {
	ds, err := s.getDefaultPrometheusDS(ctx)
	if err != nil {
		return nil, err
	}

	metrics := map[string]float64{}
	queries := map[string]string{
		"rx_bytes":    fmt.Sprintf(`sum(rate(container_network_receive_bytes_total{pod="%s",namespace="%s"}[5m]))`, pod, namespace),
		"tx_bytes":    fmt.Sprintf(`sum(rate(container_network_transmit_bytes_total{pod="%s",namespace="%s"}[5m]))`, pod, namespace),
		"rx_packets":  fmt.Sprintf(`sum(rate(container_network_receive_packets_total{pod="%s",namespace="%s"}[5m]))`, pod, namespace),
		"tx_packets":  fmt.Sprintf(`sum(rate(container_network_transmit_packets_total{pod="%s",namespace="%s"}[5m]))`, pod, namespace),
		"rx_errors":   fmt.Sprintf(`sum(rate(container_network_receive_errors_total{pod="%s",namespace="%s"}[5m]))`, pod, namespace),
		"tx_errors":   fmt.Sprintf(`sum(rate(container_network_transmit_errors_total{pod="%s",namespace="%s"}[5m]))`, pod, namespace),
	}

	for key, q := range queries {
		metrics[key] = s.queryPromQLScalar(ctx, ds, q)
	}
	return metrics, nil
}

// EnhanceTopology 增强拓扑：K8s 逻辑拓扑 + Prometheus 流量 + 抓包解析
func (s *NetworkTraceService) EnhanceTopology(ctx context.Context, clusterID uint, namespace, podName string) (*TopologyData, map[string]float64, error) {
	// 1. 基础逻辑拓扑
	topo, err := s.BuildTopology(clusterID, namespace, podName)
	if err != nil {
		return nil, nil, err
	}

	// 2. Prometheus 流量聚合（仅作为目标节点摘要，无法提供 Pod-to-Pod 关系）
	pm, _ := s.GetPodTrafficMetrics(ctx, namespace, podName)

	// 3. 尝试获取已有的抓包日志并解析成真实流量边
	rawLogs, err := s.GetDebugLogs(ctx, clusterID, namespace, podName)
	if err == nil && rawLogs != "" {
		topo, _ = s.BuildTopologyFromCapture(clusterID, namespace, podName, rawLogs)
	}

	// 4. 将 Prometheus 聚合流量按比例分配到拓扑边上（仅有逻辑边时）
	if len(topo.Edges) > 0 {
		// 如果有Prometheus数据但没有抓包解析出具体流量，给边一个估算值
		totalBytes := int(pm["rx_bytes"] + pm["tx_bytes"])
		if totalBytes > 0 {
			// 检查是否已经由抓包解析填充了真实请求数
			hasCaptureData := false
			for _, e := range topo.Edges {
				if e.Requests > 0 {
					hasCaptureData = true
					break
				}
			}
			if !hasCaptureData {
				avgBytes := totalBytes / len(topo.Edges)
				for i := range topo.Edges {
					topo.Edges[i].Bytes = avgBytes
					topo.Edges[i].Requests = int(avgBytes/1024) + 1
				}
			}
		}
	}

	return topo, pm, nil
}

// BuildTopologyFromCapture 将 tcpdump 原始日志解析为拓扑
func (s *NetworkTraceService) BuildTopologyFromCapture(clusterID uint, namespace, podName, rawLogs string) (*TopologyData, error) {
	topo, err := s.BuildTopology(clusterID, namespace, podName)
	if err != nil {
		return nil, err
	}

	edges, err := s.ParseTcpdumpSummary(rawLogs)
	if err != nil {
		return nil, err
	}

	nodeMap := make(map[string]bool)
	nodeMap[topo.Target.ID] = true
	for _, n := range topo.Nodes {
		nodeMap[n.ID] = true
	}

	for _, e := range edges {
		ns1, pod1, err1 := s.ResolveIPToPod(clusterID, e.Source)
		ns2, pod2, err2 := s.ResolveIPToPod(clusterID, e.Target)
		if err1 != nil && err2 != nil {
			continue
		}

		var srcID, dstID string
		if err1 == nil {
			srcID = fmt.Sprintf("pod:%s/%s", ns1, pod1)
			if !nodeMap[srcID] {
				nodeMap[srcID] = true
				topo.Nodes = append(topo.Nodes, TopologyNode{
					ID:         srcID,
					Name:       pod1,
					Namespace:  ns1,
					Type:       "pod",
					SymbolSize: 30,
				})
			}
		} else {
			// 外部 IP
			srcID = fmt.Sprintf("ip:%s", e.Source)
			if !nodeMap[srcID] {
				nodeMap[srcID] = true
				topo.Nodes = append(topo.Nodes, TopologyNode{
					ID:         srcID,
					Name:       e.Source,
					Type:       "external",
					SymbolSize: 30,
				})
			}
		}

		if err2 == nil {
			dstID = fmt.Sprintf("pod:%s/%s", ns2, pod2)
			if !nodeMap[dstID] {
				nodeMap[dstID] = true
				topo.Nodes = append(topo.Nodes, TopologyNode{
					ID:         dstID,
					Name:       pod2,
					Namespace:  ns2,
					Type:       "pod",
					SymbolSize: 30,
				})
			}
		} else {
			dstID = fmt.Sprintf("ip:%s", e.Target)
			if !nodeMap[dstID] {
				nodeMap[dstID] = true
				topo.Nodes = append(topo.Nodes, TopologyNode{
					ID:         dstID,
					Name:       e.Target,
					Type:       "external",
					SymbolSize: 30,
				})
			}
		}

		// 避免重复边
		exists := false
		for i := range topo.Edges {
			if topo.Edges[i].Source == srcID && topo.Edges[i].Target == dstID {
				topo.Edges[i].Requests++
				exists = true
				break
			}
		}
		if !exists {
			e.Source = srcID
			e.Target = dstID
			topo.Edges = append(topo.Edges, e)
		}
	}

	return topo, nil
}

func stripPort(addr string) string {
	// IPv4 格式: 10.0.0.1.8080 或 10.0.0.1:8080
	// tcpdump -nn 输出是 10.0.0.1.8080
	lastDot := strings.LastIndex(addr, ".")
	if lastDot > 0 {
		// 检查最后一段是否是数字（端口）
		if _, err := strconv.Atoi(addr[lastDot+1:]); err == nil {
			return addr[:lastDot]
		}
	}
	// 备用: IPv6 或 host:port
	if idx := strings.LastIndex(addr, ":"); idx > 0 {
		return addr[:idx]
	}
	return addr
}

// RunTcpdumpAndWait 启动抓包并等待获取结果
func (s *NetworkTraceService) RunTcpdumpAndWait(ctx context.Context, clusterID uint, namespace, pod, image string, duration time.Duration) (string, error) {
	if err := s.CreateEphemeralDebug(ctx, clusterID, namespace, pod, image,
		fmt.Sprintf("tcpdump -i any -nn -U -l > /tmp/capture.log 2>&1 & TPID=$!; sleep %d; kill $TPID 2>/dev/null; cat /tmp/capture.log", int(duration.Seconds()))); err != nil {
		return "", err
	}

	// 等待 tcpdump 完成
	time.Sleep(duration + 3*time.Second)

	// 获取日志
	return s.GetDebugLogs(ctx, clusterID, namespace, pod)
}

func int64Ptr(v int64) *int64 {
	return &v
}
