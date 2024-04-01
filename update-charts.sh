#!/bin/env bash

helmdir="./helm/"
helmchartsdir="$helmdir/charts/"

mkdir -p "$helmchartsdir"
(
  pushd "$helmdir" || exit
  helm dependency update
)

# Destination directory (where untarred charts will go)
dest="./charts/"

mkdir -p "$helmchartsdir"
mkdir -p "$dest"

if [ -z "$(ls -A $helmchartsdir)" ]; then
  echo "No tar.gz files found in $helmchartsdir"
  exit 1
fi

# Clean the destination directory
rm -rf "$dest"*

# Loop through each tar.gz file
for tarball in "$helmchartsdir"*.tgz; do
  # Extract chart into destination directory
  tar -xzf "$tarball" -C "$dest"
done

mv "$dest"base "$dest"istio-base
mv "$dest"cni "$dest"istio-cni
