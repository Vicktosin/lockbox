#!/bin/sh
# MAINTAINER ONLY. Stage/provision, never enable/start services or change DNS/firewall automatically.
set -eu
umask 077
if [ "$(id -u)" -ne 0 ]; then echo 'Maintainer must provision dedicated service users and protected directories as root.' >&2; exit 1; fi
if [ "$#" -ne 1 ]; then echo 'Usage: install-linux.sh /protected/backend.env' >&2; exit 1; fi
release_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
test "$release_root" = /opt/lockbox || { echo 'Stage the validated release at /opt/lockbox before provisioning.' >&2; exit 1; }
env_file=$1
case "$env_file" in /*) ;; *) echo 'Use an absolute protected deployment configuration path.' >&2; exit 1;; esac
if [ ! -f "$env_file" ] || [ -L "$env_file" ]; then echo 'Protected deployment configuration is missing or linked.' >&2; exit 1; fi
if [ "$(stat -c '%a' "$env_file")" != 600 ] || [ "$(stat -c '%u' "$env_file")" != 0 ]; then echo 'Deployment configuration must be root-owned mode 600.' >&2; exit 1; fi
command -v node >/dev/null
command -v caddy >/dev/null
command -v systemd-analyze >/dev/null
node -e 'if(Number(process.versions.node.split(".")[0])!==24)process.exit(1)'
test -f "$release_root/dist/index.html"
id lockbox >/dev/null 2>&1 || useradd --system --home-dir /var/lib/lockbox --shell /usr/sbin/nologin lockbox
install -d -m 700 -o lockbox -g lockbox /var/lib/lockbox
install -d -m 750 -o root -g lockbox /etc/lockbox
# Never replace an existing installation's protected environment.
if [ -e /etc/lockbox/backend.env ]; then cmp -s "$env_file" /etc/lockbox/backend.env || { echo 'Existing configuration differs; no overwrite performed.' >&2; exit 1; }; else install -m 640 -o root -g lockbox "$env_file" /etc/lockbox/backend.env; fi
cd "$release_root"
runuser -u lockbox -- env NODE_ENV=production node --env-file=/etc/lockbox/backend.env --experimental-strip-types scripts/install-prepare.mjs
systemd-analyze verify deploy/lockbox.service
install -m 644 -o root -g root deploy/lockbox.service /etc/systemd/system/lockbox.service
echo 'Backend provisioned. Services remain stopped. Maintainer must validate the approved HTTPS host/Caddy configuration and obtain deployment approval before starting or exposing listeners.'
