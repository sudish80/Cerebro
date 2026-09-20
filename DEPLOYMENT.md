# Deployment Guide

This guide covers deploying Cerebro Trader to production.

## Prerequisites

- **Bun** ≥ 1.1.0
- **Node.js** ≥ 20 (for compatibility)
- **Docker** ≥ 24 (for containerized deployment)
- **Kubernetes** ≥ 1.27 (for K8s deployment)

---

## Environment Variables

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `TYPESAFE_API_KEY` | TypeSafe Jev API key | `jv_abc123...` |
| `PRIVATE_KEY` | Wallet private key (64 hex chars) | `0x1234...` |

### Optional — Trading Mode

| Variable | Default | Description |
|----------|---------|-------------|
| `DRY_RUN` | `true` | `false` to enable live trading |
| `CHAIN_ID` | `10143` | Chain ID (Monad testnet) |
| `RPC_URL` | - | Custom RPC endpoint |

### Optional — Strategy

| Variable | Default | Description |
|----------|---------|-------------|
| `ENSEMBLE_QUERY_COUNT` | `1` | Number of Jev queries (1-5) |
| `ENSEMBLE_METHOD` | `majority` | `majority` \| `weighted` \| `consensus` |
| `ENSEMBLE_CONFIDENCE_THRESHOLD` | `0.3` | Min confidence to count vote |
| `MULTI_TIMEFRAMES` | `1,5,15,60` | Timeframes in minutes |

### Optional — Observability

| Variable | Default | Description |
|----------|---------|-------------|
| `METRICS_PORT` | `9090` | Prometheus metrics port |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `LOG_JSON` | `false` | `true` for JSON output |
| `TELEGRAM_BOT_TOKEN` | - | Telegram bot token |
| `TELEGRAM_CHAT_ID` | - | Telegram chat ID |
| `ALERT_WEBHOOK_URL` | - | Slack/Discord webhook |

### Optional — Secrets

| Variable | Default | Description |
|----------|---------|-------------|
| `VAULT_ADDR` | - | HashiCorp Vault address |
| `VAULT_TOKEN` | - | Vault authentication token |
| `VAULT_MOUNT_PATH` | `secret` | KV mount path |

---

## Local Development

```bash
# Install dependencies
bun install

# Run in dry-run mode
bun run start

# Run with custom env
DRY_RUN=false LOG_LEVEL=debug bun run start
```

---

## Docker

### Build

```bash
docker build -t cerebro-trader:latest .
```

### Run

```bash
docker run -d \
  --name cerebro \
  --restart unless-stopped \
  -e TYPESAFE_API_KEY="$TYPESAFE_API_KEY" \
  -e PRIVATE_KEY="$PRIVATE_KEY" \
  -e DRY_RUN=false \
  -e METRICS_PORT=9090 \
  -p 9090:9090 \
  cerebro-trader:latest
```

### Multi-stage Build Details

The Dockerfile uses a multi-stage build:
1. **Builder stage** — Installs deps, runs `bun build` to compile TypeScript
2. **Runtime stage** — Copies only `dist/` and `node_modules/` (production), runs as non-root user

---

## Kubernetes

### Namespace

```bash
kubectl create namespace cerebro
```

### Secrets

```bash
kubectl create secret generic cerebro-secrets \
  --from-literal=typesafe-api-key="$TYPESAFE_API_KEY" \
  --from-literal=private-key="$PRIVATE_KEY" \
  --from-literal=telegram-bot-token="$TELEGRAM_BOT_TOKEN" \
  --from-literal=telegram-chat-id="$TELEGRAM_CHAT_ID" \
  --from-literal=alert-webhook-url="$ALERT_WEBHOOK_URL" \
  -n cerebro
```

### Deployment

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cerebro-trader
  namespace: cerebro
  labels:
    app: cerebro-trader
spec:
  replicas: 1
  selector:
    matchLabels:
      app: cerebro-trader
  template:
    metadata:
      labels:
        app: cerebro-trader
    spec:
      containers:
      - name: cerebro
        image: cerebro-trader:latest
        imagePullPolicy: IfNotPresent
        env:
        - name: TYPESAFE_API_KEY
          valueFrom:
            secretKeyRef:
              name: cerebro-secrets
              key: typesafe-api-key
        - name: PRIVATE_KEY
          valueFrom:
            secretKeyRef:
              name: cerebro-secrets
              key: private-key
        - name: DRY_RUN
          value: "false"
        - name: METRICS_PORT
          value: "9090"
        - name: LOG_LEVEL
          value: "info"
        - name: LOG_JSON
          value: "true"
        ports:
        - containerPort: 9090
          name: metrics
        livenessProbe:
          httpGet:
            path: /health
            port: 9090
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /health
            port: 9090
          initialDelaySeconds: 10
          periodSeconds: 5
        resources:
          requests:
            cpu: "250m"
            memory: "512Mi"
          limits:
            cpu: "1000m"
            memory: "1Gi"
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        fsGroup: 1000
```

### Service

```yaml
# k8s/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: cerebro-trader
  namespace: cerebro
spec:
  selector:
    app: cerebro-trader
  ports:
  - port: 9090
    targetPort: 9090
    name: metrics
  type: ClusterIP
```

### ServiceMonitor (Prometheus Operator)

```yaml
# k8s/servicemonitor.yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: cerebro-trader
  namespace: cerebro
spec:
  selector:
    matchLabels:
      app: cerebro-trader
  endpoints:
  - port: metrics
    path: /metrics
    interval: 15s
```

### Apply

```bash
kubectl apply -f k8s/ -n cerebro
```

---

## Monitoring Stack

### Prometheus

```yaml
# prometheus/values.yaml
prometheus:
  prometheusSpec:
    serviceMonitorSelector:
      matchLabels:
        release: prometheus
```

### Grafana Dashboard

Import the dashboard JSON from `grafana/cerebro-dashboard.json` (includes panels for trades, PnL, Jev latency, portfolio balance, drawdown, risk rejections, execution latency).

---

## Security Checklist

- [ ] Private key stored in K8s secret (not ConfigMap)
- [ ] API keys in secrets, never in code
- [ ] Network policies restrict egress to only required endpoints
- [ ] PodSecurityPolicy / PodSecurityStandard: restricted
- [ ] Resource limits set to prevent OOM kills
- [ ] Non-root user (UID 1000) in container
- [ ] Read-only root filesystem where possible
- [ ] TLS for metrics endpoint in production (add sidecar proxy)

---

## Rollout Strategy

```bash
# Blue-green or rolling update
kubectl set image deployment/cerebro-trader cerebro=cerebro-trader:v1.2.0 -n cerebro

# Verify
kubectl rollout status deployment/cerebro-trader -n cerebro

# Rollback if needed
kubectl rollout undo deployment/cerebro-trader -n cerebro
```

---

## Troubleshooting

### Bot Not Starting

```bash
# Check logs
kubectl logs -f deployment/cerebro-trader -n cerebro

# Common issues:
# - TYPESAFE_API_KEY not set
# - PRIVATE_KEY invalid format (must be 0x + 64 hex chars)
# - RPC_URL unreachable
# - Config validation failing (check logs for details)
```

### Metrics Not Appearing

```bash
# Check metrics endpoint
kubectl port-forward svc/cerebro-trader 9090:9090 -n cerebro
curl http://localhost:9090/metrics
```

### Alerts Not Firing

- Verify `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are correct
- Test webhook: `curl -X POST -H "Content-Type: application/json" -d '{"text":"test"}' $ALERT_WEBHOOK_URL`
- Check alert throttling (1 alert/category/5min)

### High Memory Usage

- Check `MAX_CACHE_ENTRIES` in jev-client.ts (default 500)
- Verify SQLite DB not growing unbounded (trade history cleanup not yet implemented)
- Consider adding `PRAGMA journal_mode=WAL` to store.ts

---

## Backup & Recovery

### SQLite Database

```bash
# Backup
kubectl exec -it cerebro-trader-<pod> -n cerebro -- sqlite3 /data/cerebro.db ".backup /tmp/backup.db"
kubectl cp cerebro/cerebro-trader-<pod>:/tmp/backup.db ./cerebro-backup-$(date +%Y%m%d).db

# Restore
kubectl cp ./cerebro-backup-20250920.db cerebro/cerebro-trader-<pod>:/data/cerebro.db
```

### Secrets Backup

```bash
kubectl get secret cerebro-secrets -n cerebro -o yaml > cerebro-secrets-backup.yaml
```

---

## Versioning

- **Semantic Versioning**: MAJOR.MINOR.PATCH
- **Git tags**: `v1.0.0`, `v1.1.0`, etc.
- **Changelog**: See `CHANGELOG.md` (auto-generated from commits)

---

## Support

- **Issues**: https://github.com/sudish80/Cerebro/issues
- **Discussions**: https://github.com/sudish80/Cerebro/discussions
- **Security**: Email security@sudish80.github.io (or open a private GitHub security advisory)