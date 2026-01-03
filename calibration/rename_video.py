#!/usr/bin/env python3
# Copyright (c) 2025 Philip Huppert. Licensed under the MIT License.

import sys
import shutil
import os
import string

tgt_dir = sys.argv[1] if len(sys.argv) > 1 else "."
renames = []

for fname in os.listdir(tgt_dir):
    if not fname.startswith("PXL_"):
        continue
    if not fname.endswith(".mp4"):
        continue
    fpath = os.path.join(tgt_dir, fname)
    if not os.path.isfile(fpath):
        continue

    i = len(renames)
    x = string.ascii_lowercase[i]
    _fname = f"{x}.mp4"
    _fpath = os.path.join(tgt_dir, _fname)
    renames.append((fpath, _fpath))

for a, b in renames:
    print(a, b)
    shutil.move(a, b)

