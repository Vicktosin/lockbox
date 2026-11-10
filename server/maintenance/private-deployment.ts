export type DeploymentProfile = 'staging' | 'household'

/** Offline configuration only. Does not provision a provider, read live data or start listeners. */
export function privateDeploymentPlan(
  hostname: string,
  profile: DeploymentProfile,
) {
  const label = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
  if (!new RegExp('^' + label + '\\.' + label + '\\.ts\\.net$').test(hostname))
    throw new Error('A_REAL_TAILNET_HOSTNAME_IS_REQUIRED')
  if (!['staging', 'household'].includes(profile))
    throw new Error('INVALID_DEPLOYMENT_PROFILE')
  const service = profile === 'staging' ? 'lockbox-staging' : 'lockbox'
  const releaseRoot = '/opt/' + service
  const dataRoot = '/var/lib/' + service
  const configRoot = '/etc/' + service
  const ingressRoot = '/etc/' + service + '-ingress'
  const backendPort = profile === 'staging' ? 8788 : 8787
  const ingressPort = profile === 'staging' ? 8081 : 8080
  const origin = 'https://' + hostname
  const backend =
    [
      'NODE_ENV=production',
      'LOCKBOX_APP_ORIGIN=' + origin,
      'LOCKBOX_BACKEND_PORT=' + backendPort,
      'LOCKBOX_DB_PATH=' + dataRoot + '/db/lockbox.sqlite',
      'LOCKBOX_KEY_FILE=' + dataRoot + '/keys/application-key.json',
      'LOCKBOX_BACKUP_DIR=' + dataRoot + '/backups',
      'LOCKBOX_LOG_LEVEL=info',
      // Google credentials are deliberately absent; staging must not inherit a real grant.
    ].join('\n') + '\n'
  const ingress =
    [
      'LOCKBOX_PRIVATE_HTTP_PORT=' + ingressPort,
      'LOCKBOX_PRIVATE_BACKEND_PORT=' + backendPort,
      'LOCKBOX_RELEASE_ROOT=' + releaseRoot,
    ].join('\n') + '\n'
  const backendUnit = `[Unit]
Description=Lockbox ${profile} backend
After=network.target
RequiresMountsFor=${dataRoot}
[Service]
Type=simple
User=${service}
Group=${service}
WorkingDirectory=${releaseRoot}
Environment=NODE_ENV=production
EnvironmentFile=${configRoot}/backend.env
ExecStart=/usr/bin/node --experimental-strip-types server/index.ts
ExecStartPost=/usr/bin/node scripts/deployment-health.mjs
Restart=on-failure
RestartSec=5
TimeoutStopSec=120
TimeoutStartSec=120
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${dataRoot}
RestrictSUIDSGID=true
[Install]
WantedBy=multi-user.target
`
  const ingressUnit = `[Unit]
Description=Lockbox ${profile} loopback ingress (private HTTPS is supplied by Tailscale Serve)
After=network.target ${service}.service
Requires=${service}.service
[Service]
Type=simple
User=caddy
Group=caddy
WorkingDirectory=${releaseRoot}
EnvironmentFile=${ingressRoot}/ingress.env
ExecStart=/usr/bin/caddy run --config ${releaseRoot}/deploy/Caddyfile.private --adapter caddyfile
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
RestrictSUIDSGID=true
[Install]
WantedBy=multi-user.target
`
  return {
    format: 'lockbox-private-deployment-v1',
    profile,
    hostname,
    origin,
    service,
    releaseRoot,
    dataRoot,
    configRoot,
    ingressRoot,
    backendPort,
    ingressPort,
    googleConfigured: false,
    deployed: false,
    files: {
      'backend.env': backend,
      'ingress.env': ingress,
      [service + '.service']: backendUnit,
      [service + '-ingress.service']: ingressUnit,
    },
    pending: [
      'Host and persistent encrypted-volume verification',
      'Private-network account, device enrollment, HTTPS and household-only policy approval',
      'Linux/systemd rehearsal and independent-device acceptance',
      'Developer Google registration/redirect/verification decision and live backup restoration',
      'Independent security review before real credentials',
    ],
  }
}
