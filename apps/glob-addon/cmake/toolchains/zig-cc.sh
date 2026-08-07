#!/bin/sh
# Zig's lld does not support --dependency-file; strip -Xlinker --dependency-file=... pairs.
args=""
while [ $# -gt 0 ]; do
  case "$1" in
    -Xlinker)
      case "${2:-}" in
        --dependency-file=*)
          shift 2
          continue
          ;;
      esac
      ;;
  esac
  args="$args \"$(printf '%s' "$1" | sed 's/["\\$`]/\\&/g')\""
  shift
done
eval "exec zig cc $args"
