#!/bin/bash
set -e
cargo +nightly fmt "$@"
