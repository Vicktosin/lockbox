#!/bin/sh
# Maintainer only. Offline provisioning; never starts/enables services or modifies networking.
set -eu
umask 077
[ "$(id -u)" -eq 0 ] || { echo 'Root is required for protected service provisioning.' >&2; exit 1; }
[ "$#" -eq 1 ] || { echo 'Usage: install-private-linux.sh /absolute/protected-plan-directory' >&2; exit 1; }
plan=$1
case "$plan" in /*) ;; *) echo 'An absolute protected plan directory is required.' >&2; exit 1;; esac
[ "$(readlink -f -- "$plan")" = "$plan" ] || { echo 'Linked/noncanonical plan rejected.' >&2; exit 1; }
release_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$release_root"
[ "$(uname -s)" = Linux ]
for program in /usr/bin/node /usr/bin/caddy; do [ -x "$program" ]; done
for program in systemd-analyze runuser mountpoint findmnt; do command -v "$program" >/dev/null; done
/usr/bin/node -e 'if(Number(process.versions.node.split(".")[0])!==24)process.exit(1)'
/usr/bin/node --experimental-strip-types scripts/prepare-private-deployment.mjs --verify "$plan"
profile=$(/usr/bin/node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).profile' "$plan/plan.json")
case "$profile" in staging) service=lockbox-staging;; household) service=lockbox;; *) exit 1;; esac
[ "$release_root" = "/opt/$service" ] || { echo 'Release is not in the profile-specific directory.' >&2; exit 1; }
[ -f dist/index.html ]
data_root=/var/lib/$service
# Never silently put data on an ephemeral/root filesystem after a volume detach.
mountpoint -q "$data_root" || { echo 'A separately mounted persistent data volume is required. No formatting or mounting is performed.' >&2; exit 1; }
case "$(findmnt -n -o FSTYPE --target "$data_root")" in ext4|xfs) ;; *) echo 'Use a local block-storage filesystem suitable for SQLite; ephemeral/network filesystems are rejected.' >&2; exit 1;; esac
for directory in "$data_root" "/etc/$service" "/etc/$service-ingress"; do [ ! -L "$directory" ] || { echo 'Linked installation directory rejected.' >&2; exit 1; }; done
if [ ! -e "$data_root/db/lockbox.sqlite" ]; then
 [ -z "$(find "$data_root" -mindepth 1 -maxdepth 1 ! -name lost+found -print -quit)" ] || { echo 'Nonempty volume without the expected database; no initialization performed.' >&2; exit 1; }
fi
id caddy >/dev/null
systemd-analyze verify "$plan/$service.service" "$plan/$service-ingress.service"
# Preflight every destination before any copy; changed configuration/units are never overwritten.
check_existing() { if [ -e "$2" ] || [ -L "$2" ]; then [ ! -L "$2" ] && cmp -s "$1" "$2" || { echo 'Existing destination differs or is linked; no overwrite performed.' >&2; exit 1; }; fi; }
check_existing "$plan/backend.env" "/etc/$service/backend.env"
check_existing "$plan/ingress.env" "/etc/$service-ingress/ingress.env"
check_existing "$plan/$service.service" "/etc/systemd/system/$service.service"
check_existing "$plan/$service-ingress.service" "/etc/systemd/system/$service-ingress.service"
id "$service" >/dev/null 2>&1 || useradd --system --home-dir "$data_root" --shell /usr/sbin/nologin "$service"
if [ -e "$data_root/db/lockbox.sqlite" ]; then
 [ "$(stat -c '%U' "$data_root")" = "$service" ] && [ "$(stat -c '%a' "$data_root")" = 700 ] || { echo 'Existing data-directory ownership/permissions require maintainer review.' >&2; exit 1; }
else
 chown "$service:$service" "$data_root"
 chmod 700 "$data_root"
fi
install -d -m 750 -o root -g "$service" "/etc/$service"
install -d -m 750 -o root -g caddy "/etc/$service-ingress"
copy_new() { if [ ! -e "$2" ]; then install -m "$3" -o root -g "$4" "$1" "$2"; fi; }
copy_new "$plan/backend.env" "/etc/$service/backend.env" 640 "$service"
copy_new "$plan/ingress.env" "/etc/$service-ingress/ingress.env" 640 caddy
runuser -u "$service" -- env NODE_ENV=production /usr/bin/node --env-file="/etc/$service/backend.env" --experimental-strip-types scripts/install-prepare.mjs
copy_new "$plan/$service.service" "/etc/systemd/system/$service.service" 644 root
copy_new "$plan/$service-ingress.service" "/etc/systemd/system/$service-ingress.service" 644 root
echo 'Prepared only; no listener or service was started/enabled. Encryption of the provider volume, private access policy, HTTPS and real-device acceptance still require verification. Google remains disconnected.'
