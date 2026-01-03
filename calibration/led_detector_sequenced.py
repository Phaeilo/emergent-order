#!/usr/bin/env python3
# Copyright (c) 2025 Philip Huppert. Licensed under the MIT License.

"""

program to detect 2D position of LEDs in a sequence of images
in the sequence of images, the LEDs will emit their identifier by flashing certain colors
 ternary encoding red=0, green=1, blue=2, least significant digit first
checksum validation: decoded ternary LED ID mod 7 must be zero
to remove checksum, divide LED ID by 7 to receive true LED ID
number of ternary digits (image frames) is 7, set as global constant so it can be changed
we want to process multiple sequences of images at a time, in this case 4 (make configurable)
each sequence will start with a dark frame, then 7 frames where the LEDs are lit
use the dark frame to remove the background from the lit frames
file names contain a counter, to convey order
example file names for a batch of 4 sequences of 7 frames/digits each:
q_subseq_01_0167_dark.png
q_subseq_01_0179.png
q_subseq_01_0203.png
q_subseq_01_0227.png
q_subseq_01_0252.png
q_subseq_01_0276.png
q_subseq_01_0300.png
q_subseq_01_0324.png
q_subseq_02_0372_dark.png
q_subseq_02_0384.png
q_subseq_02_0408.png
q_subseq_02_0433.png
q_subseq_02_0457.png
q_subseq_02_0481.png
q_subseq_02_0505.png
q_subseq_02_0529.png
q_subseq_03_0578_dark.png
q_subseq_03_0590.png
q_subseq_03_0614.png
q_subseq_03_0638.png
q_subseq_03_0662.png
q_subseq_03_0686.png
q_subseq_03_0710.png
q_subseq_03_0734.png
q_subseq_04_0783_dark.png
q_subseq_04_0795.png
q_subseq_04_0819.png
q_subseq_04_0843.png
q_subseq_04_0867.png
q_subseq_04_0891.png
q_subseq_04_0915.png
q_subseq_04_0940.png

output interesting logs using logging framework on stderr
output solution on stdout, if any
solution needs to have input image size:
FRAME_SIZE w h
and position of LEDs
LED_s_i x y
where s is the sequence the LED was detected in, and i is the ID in that sequence, x and y are the image coords of the LED

for plausibility checks, assume we have 200 LEDs in each sequence (configurable global const)
not all LEDs may be visible or detectable, but never more than 200 per sequence

proposed algo:
filenames input via argv
sort and process filnames
foreach batch
    foreach lit image
        load image
        subtract background
        classify each pixel color: red, green, blue, other
        store classifications for each pixel
    foreach pixel
        if classified as color in each image, decode ternary, validate checksum
        if valid ID, store for pixel
        note down unique IDs observed
    foreach unique ID
        compute midpoint (x/y) of all pixels that were identified as ID
        output solution



"""

import logging
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np

# Configuration constants
NUM_TERNARY_DIGITS = 9
NUM_SEQUENCES_PER_BATCH = 1
MAX_LEDS_PER_SEQUENCE = 200*6
MAX_LEDS_PER_SEQUENCE = 75
MIN_PIXELS_FOR_LED = 8
MIN_PIXELS_FOR_LED = 16

# Color classification parameters
BRIGHTNESS_THRESHOLD_PERCENTILE = 99.0
BRIGHTNESS_THRESHOLD_PERCENTILE = 99.5
COLOR_PURITY_RATIO = 2.0
GREEN_CORRECTION_FACTOR = 1.5  # Adjust green channel for color temperature (1.0 = no correction, >1.0 boosts green vs blue)
ALTERNATE_COLOR_MODE = False

# Morphological filtering parameters
MORPHOLOGICAL_FILTERING = False
ERODE_KERNEL_SIZE = 5
ERODE_ITERATIONS = 1
ERODE_ITERATIONS = 2
DILATE_KERNEL_SIZE = 3
DILATE_ITERATIONS = 0

# Setup logging - level controlled by LOG_LEVEL env var
log_level = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, log_level, logging.INFO), format="%(levelname)s: %(message)s", stream=sys.stderr
)
logger = logging.getLogger(__name__)

# Debug output control
DEBUG_OUTPUT = os.getenv("DEBUG_OUTPUT", "0") == "1"


def parse_filename(filepath: str):
    """Parse filename: prefix_subseq_XX_YYYY[_dark|_mask].png"""
    filename = Path(filepath).name
    # Pattern: <prefix>_subseq_<subseq_num>_<counter>[_dark|_mask].png
    pattern = r"^(.+?)_subseq_(\d+)_(\d+)(_dark|_mask)?\.png$"
    match = re.match(pattern, filename)

    if not match:
        logger.warning(f"Cannot parse filename: {filename}")
        return None

    prefix, subseq, counter, suffix = match.groups()

    return {
        "filepath": filepath,
        "prefix": prefix,
        "subseq": int(subseq),
        "counter": int(counter),
        "is_dark": suffix == "_dark",
        "is_mask": suffix == "_mask",
    }


def group_files_into_batches(filepaths):
    batches = defaultdict(list)

    for filepath in filepaths:
        info = parse_filename(filepath)
        if info:
            key = (info["prefix"], info["subseq"])
            batches[key].append(info)

    # Sort each batch by counter
    for key in batches:
        batches[key].sort(key=lambda x: x["counter"])

    return batches


def validate_batch(batch):
    dark_frames = [f for f in batch if f["is_dark"]]
    mask_frames = [f for f in batch if f["is_mask"]]
    lit_frames = [f for f in batch if not f["is_dark"] and not f["is_mask"]]

    if len(dark_frames) != 1:
        logger.error(f"Batch has {len(dark_frames)} dark frames, expected 1")
        return False

    if len(mask_frames) > 1:
        logger.error(f"Batch has {len(mask_frames)} mask frames, expected 0 or 1")
        return False

    if len(lit_frames) != NUM_TERNARY_DIGITS:
        logger.error(f"Batch has {len(lit_frames)} lit frames, expected {NUM_TERNARY_DIGITS}")
        return False

    return True


def apply_morphological_filtering(binary_mask):
    """Apply erosion then dilation to clean up noise and fill gaps"""
    if not MORPHOLOGICAL_FILTERING:
        return binary_mask

    erode_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ERODE_KERNEL_SIZE, ERODE_KERNEL_SIZE))
    dilate_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (DILATE_KERNEL_SIZE, DILATE_KERNEL_SIZE))

    eroded = cv2.erode(binary_mask, erode_kernel, iterations=ERODE_ITERATIONS)
    filtered = cv2.dilate(eroded, dilate_kernel, iterations=DILATE_ITERATIONS)

    return filtered


def classify_image_colors(image, dark_frame, mask=None):
    """Subtract background, threshold per channel, and classify pure colors"""
    # Subtract background
    subtracted = image.astype(np.int16) - dark_frame.astype(np.int16)
    subtracted = np.clip(subtracted, 0, 255).astype(np.uint8)

    # Apply mask if provided (multiply by normalized mask to zero out irrelevant pixels)
    if mask is not None:
        mask_normalized = mask.astype(np.float32) / 255.0
        # Expand mask to 3 channels if needed
        if len(mask.shape) == 2:
            mask_normalized = np.stack([mask_normalized] * 3, axis=-1)
        subtracted = (subtracted.astype(np.float32) * mask_normalized).astype(np.uint8)

    # Apply per-channel thresholding to keep only brightest pixels
    h, w, c = subtracted.shape
    thresholded = np.zeros_like(subtracted)

    for channel in range(3):  # R, G, B channels
        channel_data = subtracted[:, :, channel]
        threshold = np.percentile(channel_data, BRIGHTNESS_THRESHOLD_PERCENTILE)
        binary_mask = (channel_data >= threshold).astype(np.uint8)

        # Apply morphological filtering to clean up noise
        if MORPHOLOGICAL_FILTERING:
            binary_mask = apply_morphological_filtering(binary_mask)

        # Apply filtered mask to original channel data
        thresholded[:, :, channel] = binary_mask * channel_data

    # Apply green correction for color temperature adjustment
    if GREEN_CORRECTION_FACTOR != 1.0:
        corrected = thresholded.astype(np.float32)
        r_temp, g_temp, b_temp = corrected[:, :, 0], corrected[:, :, 1], corrected[:, :, 2]

        # Find pixels where green and blue are both significant (potential cyan-appearing greens)
        cyan_mask = (g_temp > 50) & (b_temp > 50) & (g_temp > r_temp)

        # Boost green relative to blue for these pixels
        corrected[:, :, 1][cyan_mask] *= GREEN_CORRECTION_FACTOR
        corrected[:, :, 2][cyan_mask] /= GREEN_CORRECTION_FACTOR

        # Clip to valid range
        thresholded = np.clip(corrected, 0, 255).astype(np.uint8)

    # Classify pure colors
    classification = np.full((h, w), "O", dtype="U1")

    r, g, b = thresholded[:, :, 0], thresholded[:, :, 1], thresholded[:, :, 2]

    # Only consider pixels that are bright enough in at least one channel
    bright_mask = (r > 0) | (g > 0) | (b > 0)

    if ALTERNATE_COLOR_MODE:
        # Alternate mode: Detect Yellow as R, Cyan as G, Magenta as B
        # Pure yellow (stored as R): high R+G, low B
        pure_r = bright_mask & (r > COLOR_PURITY_RATIO * b) & (g > COLOR_PURITY_RATIO * b)

        # Pure cyan (stored as G): high G+B, low R
        pure_g = bright_mask & (g > COLOR_PURITY_RATIO * r) & (b > COLOR_PURITY_RATIO * r)

        # Pure magenta (stored as B): high R+B, low G
        pure_b = bright_mask & (r > COLOR_PURITY_RATIO * g) & (b > COLOR_PURITY_RATIO * g)
    else:
        # Normal mode: Detect Red, Green, Blue
        # Pure red: R > ratio * G and R > ratio * B
        pure_r = bright_mask & (r > COLOR_PURITY_RATIO * g) & (r > COLOR_PURITY_RATIO * b)

        # Pure green: G > ratio * R and G > ratio * B
        pure_g = bright_mask & (g > COLOR_PURITY_RATIO * r) & (g > COLOR_PURITY_RATIO * b)

        # Pure blue: B > ratio * R and B > ratio * G
        pure_b = bright_mask & (b > COLOR_PURITY_RATIO * r) & (b > COLOR_PURITY_RATIO * g)

    # Pure white: All three channels are bright and relatively balanced
    # Check if all channels are above a minimum threshold and within a ratio of each other
    min_brightness = 50  # Minimum brightness for white detection
    white_balance_ratio = 1.25  # Channels must be within this ratio of each other

    all_bright = (r > min_brightness) & (g > min_brightness) & (b > min_brightness)
    max_val = np.maximum(np.maximum(r, g), b)
    min_val = np.minimum(np.minimum(r, g), b)
    balanced = (max_val <= white_balance_ratio * min_val)

    pure_w = all_bright & balanced

    classification[pure_r] = "R"
    classification[pure_g] = "G"
    classification[pure_b] = "B"
    classification[pure_w] = "W"

    return classification


def decode_ternary(colors: str) -> int:
    """R=0, G=1, B=2, LSB first"""
    value = 0
    for i, color in enumerate(colors):
        if color == "R":
            digit = 0
        elif color == "G":
            digit = 1
        elif color == "B":
            digit = 2
        else:
            return -1  # Invalid color

        value += digit * (3**i)

    return value


def validate_checksum(led_id: int) -> bool:
    return led_id % 7 == 0
    # n = get_true_led_id(led_id)
    # n = (n * 7) + (7 - (n % 7))
    # return n == led_id


def get_true_led_id(led_id_with_checksum: int) -> int:
    return led_id_with_checksum // 9
    # if led_id_with_checksum % 7 == 0:
    #     return (led_id_with_checksum // 7) - 1
    # else:
    #     return led_id_with_checksum // 7


def id_to_color(led_id):
    """Deterministic color for each LED ID"""
    r = (led_id * 137) % 256
    g = (led_id * 211) % 256
    b = (led_id * 173) % 256
    return (r, g, b)


def create_id_map_image(h, w, led_pixels, invalid_pixels=None, white_pixels=None):
    img = np.zeros((h, w, 3), dtype=np.uint8)

    # Draw valid LED IDs with unique colors
    for led_id, pixels in led_pixels.items():
        color = id_to_color(led_id)
        for x, y in pixels:
            img[y, x] = color

    # Draw checksum-failed pixels in magenta
    if invalid_pixels:
        for x, y in invalid_pixels:
            img[y, x] = [255, 0, 255]  # Magenta

    # Draw white pixels in white
    if white_pixels:
        for x, y in white_pixels:
            img[y, x] = [255, 255, 255]  # White

    return img


def create_position_overlay(first_lit_frame, led_positions):
    img = first_lit_frame.copy()
    font = cv2.FONT_HERSHEY_SIMPLEX
    font_scale = 0.5
    font_thickness = 1
    crosshair_size = 10

    for led_id, (x, y) in led_positions.items():
        # Draw crosshair
        color = (0, 255, 0)  # Green crosshair
        cv2.line(img, (x - crosshair_size, y), (x + crosshair_size, y), color, 1)
        cv2.line(img, (x, y - crosshair_size), (x, y + crosshair_size), color, 1)

        # Draw LED ID text
        text = str(led_id)
        text_size = cv2.getTextSize(text, font, font_scale, font_thickness)[0]
        text_x = x + crosshair_size + 5
        text_y = y + 5

        # Background rectangle for text
        cv2.rectangle(
            img, (text_x - 2, text_y - text_size[1] - 2), (text_x + text_size[0] + 2, text_y + 2), (0, 0, 0), -1
        )
        cv2.putText(img, text, (text_x, text_y), font, font_scale, (0, 255, 0), font_thickness)

    return img


def create_classification_image(classification):
    """Create debug image showing classified pixels as pure RGB colors"""
    h, w = classification.shape
    img = np.zeros((h, w, 3), dtype=np.uint8)

    # Map classifications to RGB colors
    img[classification == "R"] = [255, 0, 0]  # Red
    img[classification == "G"] = [0, 255, 0]  # Green
    img[classification == "B"] = [0, 0, 255]  # Blue
    img[classification == "W"] = [255, 255, 255]  # White
    # 'O' stays black (0, 0, 0)

    return img


def process_batch(batch):
    # Find dark frame, mask frame, and lit frames
    dark_frame_info = [f for f in batch if f["is_dark"]][0]
    mask_frames_info = [f for f in batch if f["is_mask"]]
    lit_frames_info = [f for f in batch if not f["is_dark"] and not f["is_mask"]]

    prefix = batch[0]["prefix"]
    subseq = batch[0]["subseq"]

    logger.info(f"Processing batch subseq {subseq}: {prefix}")
    logger.debug(f"  Dark frame: {dark_frame_info['filepath']}")

    # Load dark frame
    dark_frame = cv2.imread(dark_frame_info["filepath"])
    if dark_frame is None:
        logger.error(f"Cannot load dark frame: {dark_frame_info['filepath']}")
        return {}, None, None
    dark_frame = cv2.cvtColor(dark_frame, cv2.COLOR_BGR2RGB)

    h, w = dark_frame.shape[:2]
    logger.debug(f"  Frame size: {w}x{h}")

    # Load mask frame if present
    mask = None
    if mask_frames_info:
        mask_frame_info = mask_frames_info[0]
        logger.debug(f"  Mask frame: {mask_frame_info['filepath']}")
        mask = cv2.imread(mask_frame_info["filepath"], cv2.IMREAD_GRAYSCALE)
        if mask is None:
            logger.error(f"Cannot load mask frame: {mask_frame_info['filepath']}")
            return {}, None, None
        logger.info(f"  Using mask with {np.sum(mask > 128)} relevant pixels out of {mask.size} total")
    else:
        logger.debug(f"  No mask frame found")

    # Load and classify all lit frames
    classifications = []
    first_lit_frame = None
    for i, lit_info in enumerate(lit_frames_info):
        image = cv2.imread(lit_info["filepath"])
        if image is None:
            logger.error(f"Cannot load image: {lit_info['filepath']}")
            return {}, None, None
        image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

        # Save first lit frame for debug overlay
        if i == 0:
            first_lit_frame = image.copy()

        # Classify colors (with optional mask)
        classified = classify_image_colors(image, dark_frame, mask)
        classifications.append(classified)

        # Log statistics
        unique, counts = np.unique(classified, return_counts=True)
        color_stats = dict(zip(unique, counts))
        logger.debug(
            f"  Frame {lit_info['counter']}: R={color_stats.get('R', 0)}, "
            f"G={color_stats.get('G', 0)}, B={color_stats.get('B', 0)}, "
            f"W={color_stats.get('W', 0)}, O={color_stats.get('O', 0)}"
        )

        # Generate per-frame classification debug image
        if DEBUG_OUTPUT:
            classification_img = create_classification_image(classified)
            debug_filename = f"debug_{prefix}_subseq_{subseq:02d}_frame_{lit_info['counter']:04d}_classification.png"
            cv2.imwrite(debug_filename, cv2.cvtColor(classification_img, cv2.COLOR_RGB2BGR))
            logger.debug(f"  Wrote classification debug image: {debug_filename}")

    # Stack classifications for per-pixel processing
    # Shape: (NUM_TERNARY_DIGITS, h, w)
    classifications_stack = np.stack(classifications, axis=0)

    # Process each pixel
    led_pixels = defaultdict(list)  # {true_led_id: [(x, y), ...]}
    invalid_pixels = []  # [(x, y), ...] pixels with checksum errors
    white_pixels = []  # [(x, y), ...] pixels classified as white
    invalid_ids = set()
    valid_count = 0
    invalid_count = 0

    for y in range(h):
        for x in range(w):
            # Get color sequence for this pixel
            color_sequence = "".join(classifications_stack[:, y, x])

            # Skip if not all frames show a color (contains 'O')
            if "O" in color_sequence:
                continue

            # Track white pixels separately (not valid for ternary decoding)
            if "W" in color_sequence:
                white_pixels.append((x, y))
                continue

            # Decode ternary
            led_id = decode_ternary(color_sequence)

            if led_id < 0:
                continue

            # Validate checksum
            if validate_checksum(led_id):
                true_id = get_true_led_id(led_id)
                if true_id not in led_pixels:
                    logger.debug(f"  Discovered new LED ID {true_id} at {x} {y}")
                led_pixels[true_id].append((x, y))
                valid_count += 1
            else:
                invalid_pixels.append((x, y))
                invalid_count += 1
                if led_id not in invalid_ids:
                    invalid_ids.add(led_id)
                    chk = led_id % 7
                    logger.debug(f"  Invalid LED ID: {led_id=} {chk=} {color_sequence=} {x=} {y=}")

    logger.info(f"  Valid pixels: {valid_count}, Invalid checksum: {invalid_count}")
    logger.info(f"  Unique LED IDs detected: {len(led_pixels)}")

    # Check plausibility
    if len(led_pixels) > MAX_LEDS_PER_SEQUENCE:
        logger.warning(f"  Detected {len(led_pixels)} unique IDs, expected max {MAX_LEDS_PER_SEQUENCE}")

    # Filter out IDs with too few pixels
    filtered_led_pixels = {led_id: pixels for led_id, pixels in led_pixels.items() if len(pixels) >= MIN_PIXELS_FOR_LED}

    filtered_out = len(led_pixels) - len(filtered_led_pixels)
    if filtered_out > 0:
        logger.info(f"  Filtered out {filtered_out} IDs with < {MIN_PIXELS_FOR_LED} pixels")

    return filtered_led_pixels, prefix, subseq, h, w, first_lit_frame, invalid_pixels, white_pixels


def compute_led_positions(led_pixels):
    led_positions = {}

    for led_id, pixels in led_pixels.items():
        if not pixels:
            continue

        # Compute mean position
        xs = [p[0] for p in pixels]
        ys = [p[1] for p in pixels]
        mean_x = int(round(np.mean(xs)))
        mean_y = int(round(np.mean(ys)))

        led_positions[led_id] = (mean_x, mean_y)

    return led_positions


def main():
    if len(sys.argv) < 2:
        logger.error("Usage: led_detector_sequenced.py <image_files...>")
        sys.exit(1)

    filepaths = sys.argv[1:]
    logger.info(f"Processing {len(filepaths)} input files")

    # Group files into batches
    batches = group_files_into_batches(filepaths)
    logger.info(f"Grouped into {len(batches)} batches")

    # Validate we have expected number of sequences
    if len(batches) != NUM_SEQUENCES_PER_BATCH:
        logger.warning(f"Expected {NUM_SEQUENCES_PER_BATCH} sequences, got {len(batches)}")

    # Get frame size from first image
    first_file = filepaths[0]
    first_image = cv2.imread(first_file)
    if first_image is None:
        logger.error(f"Cannot load first image: {first_file}")
        sys.exit(1)

    frame_h, frame_w = first_image.shape[:2]

    # Output frame size to stdout
    print(f"FRAME_SIZE {frame_w} {frame_h}")

    # Process each batch
    all_results = []
    for (prefix, subseq), batch in sorted(batches.items()):
        # Validate batch structure
        if not validate_batch(batch):
            logger.error(f"Skipping invalid batch: {prefix}_subseq_{subseq:02d}")
            continue

        # Process batch
        led_pixels, prefix, subseq, h, w, first_lit_frame, invalid_pixels, white_pixels = process_batch(batch)

        # Compute positions
        led_positions = compute_led_positions(led_pixels)

        # Store results
        for led_id, (x, y) in sorted(led_positions.items()):
            all_results.append((subseq, led_id, x, y))

        logger.info(f"  Final LED count: {len(led_positions)}")

        # Generate debug images if requested
        if DEBUG_OUTPUT:
            # ID map image with invalid pixels in magenta and white pixels in white
            id_map = create_id_map_image(h, w, led_pixels, invalid_pixels, white_pixels)
            id_map_filename = f"debug_{prefix}_subseq_{subseq:02d}_id_map.png"
            cv2.imwrite(id_map_filename, cv2.cvtColor(id_map, cv2.COLOR_RGB2BGR))
            logger.info(f"  Wrote debug ID map: {id_map_filename}")

            # Position overlay image
            if first_lit_frame is not None:
                overlay = create_position_overlay(first_lit_frame, led_positions)
                overlay_filename = f"debug_{prefix}_subseq_{subseq:02d}_positions.png"
                cv2.imwrite(overlay_filename, cv2.cvtColor(overlay, cv2.COLOR_RGB2BGR))
                logger.info(f"  Wrote debug positions overlay: {overlay_filename}")

    # Output all results to stdout
    logger.info(f"Total LEDs detected across all sequences: {len(all_results)}")

    for subseq, led_id, x, y in all_results:
        print(f"LED_{subseq}_{led_id} {x} {y}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
