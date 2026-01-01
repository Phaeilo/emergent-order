#!/usr/bin/env python3
import sys

coords = {}
max_id = 0

for line in sys.stdin:
    if line.startswith('LED_'):
        parts = line.strip().split()
        _id = int(parts[0].rpartition("_")[-1])
        if _id > max_id:
            max_id = _id
        if len(parts) >= 4:
            x, y, z = float(parts[1]), float(parts[2]), float(parts[3])
            coords[_id] = (x,y,z)


xs = [x[0] for x in coords.values()]
ys = [x[1] for x in coords.values()]
zs = [x[2] for x in coords.values()]

min_x, max_x = min(xs), max(xs)
min_y, max_y = min(ys), max(ys)
min_z, max_z = min(zs), max(zs)

normalized = {}
for _id, (x, y, z) in coords.items():
    norm_x = 2 * (x - min_x) / (max_x - min_x) - 1 if max_x != min_x else 0
    norm_y = 2 * (y - min_y) / (max_y - min_y) - 1 if max_y != min_y else 0
    norm_z = 2 * (z - min_z) / (max_z - min_z) - 1 if max_z != min_z else 0
    normalized[_id] = (norm_x, norm_y, norm_z)

# Find outliers (extremes on each axis and furthest from center)
import math
max_x_id = max(normalized.items(), key=lambda item: item[1][0])
min_x_id = min(normalized.items(), key=lambda item: item[1][0])
max_y_id = max(normalized.items(), key=lambda item: item[1][1])
min_y_id = min(normalized.items(), key=lambda item: item[1][1])
max_z_id = max(normalized.items(), key=lambda item: item[1][2])
min_z_id = min(normalized.items(), key=lambda item: item[1][2])
max_dist_id = max(normalized.items(), key=lambda item: math.sqrt(item[1][0]**2 + item[1][1]**2 + item[1][2]**2))

print("=== Maximum Outlier Coordinates ===", file=sys.stderr)
print(f"Max X: LED_{max_x_id[0]} at ({max_x_id[1][0]:.6f}, {max_x_id[1][1]:.6f}, {max_x_id[1][2]:.6f})", file=sys.stderr)
print(f"Min X: LED_{min_x_id[0]} at ({min_x_id[1][0]:.6f}, {min_x_id[1][1]:.6f}, {min_x_id[1][2]:.6f})", file=sys.stderr)
print(f"Max Y: LED_{max_y_id[0]} at ({max_y_id[1][0]:.6f}, {max_y_id[1][1]:.6f}, {max_y_id[1][2]:.6f})", file=sys.stderr)
print(f"Min Y: LED_{min_y_id[0]} at ({min_y_id[1][0]:.6f}, {min_y_id[1][1]:.6f}, {min_y_id[1][2]:.6f})", file=sys.stderr)
print(f"Max Z: LED_{max_z_id[0]} at ({max_z_id[1][0]:.6f}, {max_z_id[1][1]:.6f}, {max_z_id[1][2]:.6f})", file=sys.stderr)
print(f"Min Z: LED_{min_z_id[0]} at ({min_z_id[1][0]:.6f}, {min_z_id[1][1]:.6f}, {min_z_id[1][2]:.6f})", file=sys.stderr)
dist = math.sqrt(max_dist_id[1][0]**2 + max_dist_id[1][1]**2 + max_dist_id[1][2]**2)
print(f"Furthest from center: LED_{max_dist_id[0]} at ({max_dist_id[1][0]:.6f}, {max_dist_id[1][1]:.6f}, {max_dist_id[1][2]:.6f}), distance={dist:.6f}", file=sys.stderr)
print("===================================", file=sys.stderr)


tmp = []
for _id in range(max_id):
    if _id in normalized:
        x, y, z = normalized[_id]
        tmp.append(f"{x:.6f}")
        tmp.append(f"{y:.6f}")
        tmp.append(f"{z:.6f}")
        print(_id, x, y, z, file=sys.stderr)
    else:
        tmp.append("?")
        tmp.append("?")
        tmp.append("?")
        print(_id, "?", file=sys.stderr)
print(",".join(tmp))
