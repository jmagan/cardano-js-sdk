#!/usr/bin/env bash

# This script install cardano-node's binaries into bin/ directory.
# If you want to include the binaries in your PATH, run:
# export PATH=$PATH:$PWD/bin

set -euo pipefail

here="$(cd "$(dirname "$0")" >/dev/null 2>&1 && pwd)"
root="$(cd "$here/.." && pwd)"
cd "$root"

clean() {
  echo "Clean up"
  rm bin.tar.gz
}
trap clean EXIT

VERSION="1.35.3"
LINUX_BUILD="17428084"
MACOS_BUILD="17428186"

rm -rf bin
mkdir -p bin

echo "Download binaries from IOG build"
case $(uname) in
Darwin)
  wget -O bin.tar.gz https://hydra.iohk.io/build/${MACOS_BUILD}/download/1/cardano-node-${VERSION}-macos.tar.gz
  ;;
Linux)
  wget -O bin.tar.gz https://hydra.iohk.io/build/${LINUX_BUILD}/download/1/cardano-node-${VERSION}-linux.tar.gz
  ;;
esac

echo "Unarchive binaries file"
tar -xzf bin.tar.gz -C bin
