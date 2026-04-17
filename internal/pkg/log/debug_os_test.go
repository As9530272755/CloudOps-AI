package log

import (
    "context"
    "fmt"
    "testing"
    "time"
)

func TestDebugOS(t *testing.T) {
    e := NewESAdapter("http://10.0.0.11:30921", map[string]string{"all": "k8s-os-logs-*"}, nil)
    req := QueryRequest{
        LogType: "all",
        TimeRange: struct {
            From time.Time
            To   time.Time
        }{
            From: time.Date(2026, 4, 15, 21, 41, 0, 0, time.FixedZone("+08", 8*3600)),
            To:   time.Date(2026, 4, 16, 21, 56, 0, 0, time.FixedZone("+08", 8*3600)),
        },
        Filters: map[string]string{},
        Limit:   50,
        Offset:  0,
    }
    
    count, err := e.Count(context.Background(), req)
    fmt.Printf("Count=%d err=%v\n", count, err)
    
    result, err := e.Query(context.Background(), req)
    fmt.Printf("Query Total=%d Entries=%d err=%v\n", result.Total, len(result.Entries), err)
    if err != nil {
        fmt.Printf("Query error: %v\n", err)
    }
}
