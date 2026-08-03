#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run this installer as root." >&2
  exit 1
fi

if ! dpkg-query -W -f='${Status}' git python3-venv python3-dev g++ > /dev/null 2>&1; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y git python3-venv python3-dev g++
fi

parser_root="/opt/palworld-save-parser"
source_dir="$parser_root/source"
venv_dir="$parser_root/venv"
parser_repository="https://github.com/deafdudecomputers/PalworldSaveTools.git"
parser_commit="c5e42c8adb5f81720adec990307058b11360495a"

install -d -m 0755 "$parser_root"
install -d -o palworld -g palworld -m 0775 /opt/palworld-dash/data
if [[ ! -d "$source_dir/.git" ]]; then
  git clone --filter=blob:none --no-checkout "$parser_repository" "$source_dir"
fi
git -C "$source_dir" fetch --depth=1 origin "$parser_commit"
git -C "$source_dir" checkout --detach "$parser_commit"

python3 -m venv "$venv_dir"
"$venv_dir/bin/pip" install --disable-pip-version-check \
  "$source_dir/src/palsav/palooz" \
  "$source_dir/src/palsav"

install -m 0644 systemd/palworld-dash-save-profile.service /etc/systemd/system/
install -m 0644 systemd/palworld-dash-save-profile.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now palworld-dash-save-profile.timer
systemctl start palworld-dash-save-profile.service
