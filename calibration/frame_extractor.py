#!/usr/bin/env python3
# Copyright (c) 2025 Philip Huppert. Licensed under the MIT License.

import cv2
import sys
import numpy as np
from collections import deque

# Configuration constants
BRIGHTNESS_THRESHOLD_PERCENT = 0.06  # 25% threshold for edge detection
ROLLING_AVERAGE_FRAMES = 5  # Number of frames to use for rolling average
SEQUENCE_LENGTH = 9  # Number of frames between magenta markers
MAGENTA_THRESHOLD_MULTIPLIER = 1.20  # Magenta threshold as multiplier of average (1.5 = 50% above average)
SUB_SEQUENCES = 1  # Number of sub-sequences to divide the main sequence into
SKIP_FIRST_FRAME_IN_SEQUENCE = False
RED_INSTEAD_OF_MAGENTA = False


def calc_brightness(frame):
    """Calculate the average brightness of a frame."""
    # Convert to grayscale if it's a color image
    if len(frame.shape) == 3:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    else:
        gray = frame
    
    # Calculate mean brightness
    return np.mean(gray)


def calc_red(frame):
    """Calculate how 'red' a frame is."""
    # Ensure frame is in BGR format (OpenCV default)
    if len(frame.shape) != 3:
        return 0.0

    # Split BGR channels
    b, g, r = cv2.split(frame.astype(np.float32))

    # Red = high red channel, low green and blue
    # Calculate red score: red minus average of green and blue
    red_score = np.mean(r - (g + b) / 2.0)

    # Normalize to 0-255 range
    return max(0.0, red_score)


def calc_magenta(frame):
    """Calculate how 'magenta' a frame is."""

    if RED_INSTEAD_OF_MAGENTA:
        return calc_red(frame)

    # Ensure frame is in BGR format (OpenCV default)
    if len(frame.shape) != 3:
        return 0.0
    
    # Convert BGR to RGB for easier understanding
    # In BGR: magenta is high Blue + high Red, low Green
    # We'll calculate magenta intensity as (B + R - G) / 2
    b, g, r = cv2.split(frame.astype(np.float32))
    
    # Magenta = high red + high blue, low green
    # Calculate magenta score: average of (red + blue - green)
    magenta_score = np.mean((r + b - g) / 2.0)
    
    # Normalize to 0-255 range
    return max(0.0, magenta_score)


def find_edges(video_file):
    """Find rising and falling edge frames based on brightness changes."""
    # Open video file
    cap = cv2.VideoCapture(video_file)
    
    if not cap.isOpened():
        print(f"Error: Could not open video file {video_file}")
        return
    
    # Get video properties
    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    
    print(f"Processing video: {video_file}")
    print(f"FPS: {fps:.2f}, Total frames: {total_frames}")
    print("-" * 50)
    
    # Keep track of brightness history
    brightness_history = deque(maxlen=ROLLING_AVERAGE_FRAMES)
    frame_number = 0
    
    # State tracking: None (unknown), True (high), False (low)
    current_state = None
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        
        # Calculate brightness for current frame
        brightness = calc_brightness(frame)
        
        # If we have enough history, check for edges
        if len(brightness_history) == ROLLING_AVERAGE_FRAMES:
            # Calculate running average of past frames
            avg_brightness = np.mean(brightness_history)
            
            # Check for rising edge (threshold% above average)
            if brightness > avg_brightness * (1 + BRIGHTNESS_THRESHOLD_PERCENT):
                new_state = True
                if current_state != new_state:
                    print(f"Frame {frame_number}: rising -> {new_state}")
                    yield (frame_number, new_state)
                    current_state = new_state
            
            # Check for falling edge (threshold% below average)
            elif brightness < avg_brightness * (1 - BRIGHTNESS_THRESHOLD_PERCENT):
                new_state = False
                if current_state != new_state:
                    print(f"Frame {frame_number}: falling -> {new_state}")
                    yield (frame_number, new_state)
                    current_state = new_state
        
        # Add current brightness to history
        brightness_history.append(brightness)
        frame_number += 1
    
    cap.release()
    print(f"\nProcessed {frame_number} frames")
    print(f"Final state: {current_state}")


def find_midframes(edge_tuples, state):
    """Find midpoint frames for intervals of the specified state.
    
    Args:
        edge_tuples: List of (frame_number, state) tuples from find_edges()
        state: Boolean - True for high state intervals, False for low state intervals
    
    Yields:
        int: Midpoint frame numbers for each interval of the specified state
    """
    for i in range(len(edge_tuples) - 1):
        current_frame, current_state = edge_tuples[i]
        next_frame, next_state = edge_tuples[i + 1]
        
        # If current edge transitions TO the target state and next edge transitions FROM the target state
        if current_state == state and next_state != state:
            # Calculate midpoint frame
            midpoint_frame = (current_frame + next_frame) // 2
            yield midpoint_frame


def find_sequence(video_file, midframe_numbers):
    """Find magenta sequence: magenta frame + 32 frames + magenta frame.
    
    Args:
        video_file: Path to video file
        midframe_numbers: List of frame numbers to check for magenta content
    
    Returns:
        List of frame numbers for the complete sequence (including magenta markers)
        or None if no sequence found
    """
    if len(midframe_numbers) < SEQUENCE_LENGTH + 2:
        print(f"Not enough frames ({len(midframe_numbers)}) for sequence detection (need at least {SEQUENCE_LENGTH + 2})")
        return None
    
    print(f"\nSearching for magenta sequence in {len(midframe_numbers)} high frames...")
    
    # Open video file
    cap = cv2.VideoCapture(video_file)
    if not cap.isOpened():
        print(f"Error: Could not open video file {video_file}")
        return None
    
    # First pass: compute all magenta scores
    magenta_scores = {}
    for frame_num in midframe_numbers:
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_num)
        ret, frame = cap.read()
        
        if ret:
            magenta_score = calc_magenta(frame)
            magenta_scores[frame_num] = magenta_score
            print(f"Frame {frame_num}: magenta score = {magenta_score:.2f}")
    
    if not magenta_scores:
        cap.release()
        print("No valid frames found for magenta analysis")
        return None
    
    # Calculate dynamic threshold based on average + percentage
    avg_magenta = np.mean(list(magenta_scores.values()))
    magenta_threshold = avg_magenta * MAGENTA_THRESHOLD_MULTIPLIER
    
    print(f"\nMagenta analysis:")
    print(f"Average magenta score: {avg_magenta:.2f}")
    print(f"Dynamic threshold: {magenta_threshold:.2f}")
    
    # Second pass: identify magenta frames using dynamic threshold
    magenta_frames = []
    for frame_num, score in magenta_scores.items():
        if score > magenta_threshold:
            magenta_frames.append(frame_num)
            print(f"Frame {frame_num}: MAGENTA (score {score:.2f} > threshold {magenta_threshold:.2f})")
    
    cap.release()
    
    if len(magenta_frames) < 2:
        print(f"Found only {len(magenta_frames)} magenta frames, need at least 2 for sequence")
        return None
    
    print(f"\nFound {len(magenta_frames)} magenta frames: {magenta_frames}")
    
    # Look for sequence: magenta + 32 frames + magenta
    expected_end_idx = end_magenta = None
    for i in range(len(magenta_frames) - 1):
        start_magenta = magenta_frames[i]
        
        # Find the index of start_magenta in midframe_numbers
        try:
            start_idx = midframe_numbers.index(start_magenta)
        except ValueError:
            continue
        
        # Check if we have enough frames after start_magenta
        if start_idx + SEQUENCE_LENGTH + 1 >= len(midframe_numbers):
            continue
        
        # The expected end magenta frame
        expected_end_idx = start_idx + SEQUENCE_LENGTH + 1
        end_magenta = midframe_numbers[expected_end_idx]
        
        # Check if end frame is also magenta
        if end_magenta in magenta_frames:
            print(f"\nFound sequence!")
            print(f"Start magenta: frame {start_magenta} (index {start_idx})")
            print(f"End magenta: frame {end_magenta} (index {expected_end_idx})")
            print(f"Sequence length: {expected_end_idx - start_idx + 1} frames")
            
            # Return all frames in the sequence (including magenta markers)
            sequence_frames = midframe_numbers[start_idx:expected_end_idx + 1]
            return sequence_frames
    
    print(f"No valid magenta sequence found: {expected_end_idx=} {end_magenta=}")
    return None


def extract_frames(video_file, frame_numbers, prefix="high"):
    """Extract specific frames and save as PNG files."""
    import os
    
    if not frame_numbers:
        print("No frames to extract.")
        return
    
    print(f"\nExtracting {len(frame_numbers)} frames...")
    
    # Get video filename without extension for prefix
    video_basename = os.path.splitext(os.path.basename(video_file))[0]
    
    # Open video file
    cap = cv2.VideoCapture(video_file)
    
    if not cap.isOpened():
        print(f"Error: Could not open video file {video_file}")
        return
    
    # Extract and save frames
    for frame_num in frame_numbers:
        # Seek to the frame
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_num)
        ret, frame = cap.read()
        
        if ret:
            # Generate output filename with video name prefix and 4-digit frame number
            output_filename = f"{video_basename}_{prefix}_{frame_num:04d}.png"
            cv2.imwrite(output_filename, frame)
            print(f"Extracted frame {frame_num} -> {output_filename}")
        else:
            print(f"Error: Could not extract frame {frame_num}")
    
    cap.release()
    print(f"\nExtracted {len(frame_numbers)} frames")


def extract_subsequence_dark_frames(video_file, subsequence_info, low_midframes):
    """Extract one dark frame per sub-sequence (before the first lit frame)."""
    import os
    
    if not subsequence_info:
        print("No sub-sequence info for dark frame extraction")
        return
        
    print(f"\nExtracting dark frames for {len(subsequence_info)} sub-sequences...")
    
    # Get video filename without extension for prefix
    video_basename = os.path.splitext(os.path.basename(video_file))[0]
    
    # Open video file
    cap = cv2.VideoCapture(video_file)
    
    if not cap.isOpened():
        print(f"Error: Could not open video file {video_file}")
        return
    
    for sub_seq_idx, first_frame, extracted_frames in subsequence_info:
        # Find the most recent dark frame before the first lit frame of this sub-sequence
        previous_dark = None
        for dark_frame in reversed(low_midframes):  # Search backwards
            if dark_frame < first_frame:
                previous_dark = dark_frame
                break
        
        if previous_dark is not None:
            print(f"Sub-sequence {sub_seq_idx}: first lit frame {first_frame}, previous dark frame {previous_dark}")
            
            # Seek to the dark frame
            cap.set(cv2.CAP_PROP_POS_FRAMES, previous_dark)
            ret, frame = cap.read()
            
            if ret:
                # Generate output filename: prefix_subseq_idx_frame_dark.png
                output_filename = f"{video_basename}_subseq_{sub_seq_idx:02d}_{previous_dark:04d}_dark.png"
                cv2.imwrite(output_filename, frame)
                print(f"Extracted dark frame {previous_dark} -> {output_filename}")
            else:
                print(f"Error: Could not extract dark frame {previous_dark}")
        else:
            print(f"Sub-sequence {sub_seq_idx}: no previous dark frame found for first lit frame {first_frame}")
    
    cap.release()


def process_subsequences(video_file, sequence_frames):
    """Process sub-sequences: exclude magenta markers and divide into sub-sequences.
    
    Returns:
        List of tuples: (sub_seq_idx, first_frame_number, extracted_frames)
    """
    if len(sequence_frames) < 3:  # At least start magenta + 1 frame + end magenta
        print("Error: Sequence too short to process sub-sequences")
        return []
    
    # Remove magenta markers (first and last frames)
    core_sequence = sequence_frames[1:-1]
    print(f"\nCore sequence (excluding magentas): {len(core_sequence)} frames")
    print(f"Core frames: {core_sequence}")
    
    # Calculate sub-sequence length
    sub_seq_length = SEQUENCE_LENGTH // SUB_SEQUENCES
    print(f"Sub-sequence length: {sub_seq_length} frames each")
    
    if len(core_sequence) != SEQUENCE_LENGTH:
        print(f"Error: Core sequence length ({len(core_sequence)}) doesn't match expected {SEQUENCE_LENGTH}")
        return []
    
    print(f"\nProcessing {SUB_SEQUENCES} sub-sequences:")
    
    subsequence_info = []
    
    for sub_seq_idx in range(SUB_SEQUENCES):
        start_idx = sub_seq_idx * sub_seq_length
        end_idx = start_idx + sub_seq_length
        
        # Get the sub-sequence frames
        sub_sequence = core_sequence[start_idx:end_idx]
        
        # Remove the first frame (marker) from each sub-sequence
        if len(sub_sequence) > 1:
            sub_sequence_data = sub_sequence[1 if SKIP_FIRST_FRAME_IN_SEQUENCE else 0:]  # Skip first frame (marker)
            first_frame = sub_sequence_data[0]  # First lit frame of this sub-sequence
            
            print(f"Sub-sequence {sub_seq_idx + 1}: {len(sub_sequence_data)} frames")
            print(f"  Original: {sub_sequence}")
            print(f"  Data frames (excluding marker): {sub_sequence_data}")
            print(f"  First lit frame: {first_frame}")
            
            # Extract the sub-sequence data frames
            prefix = f"subseq_{sub_seq_idx + 1:02d}"
            extract_frames(video_file, sub_sequence_data, prefix)
            
            # Store info for dark frame extraction
            subsequence_info.append((sub_seq_idx + 1, first_frame, sub_sequence_data))
        else:
            print(f"Sub-sequence {sub_seq_idx + 1}: Not enough frames")
    
    return subsequence_info


def main():
    """Main function to handle command line arguments and process video."""
    if len(sys.argv) != 2:
        print("Usage: python frame_extractor.py <video_file>")
        print("Example: python frame_extractor.py video.mp4")
        sys.exit(1)
    
    video_file = sys.argv[1]
    
    # Check if file exists
    import os
    if not os.path.exists(video_file):
        print(f"Error: Video file '{video_file}' not found")
        sys.exit(1)
    
    print(f"Configuration: Looking for magenta sequences with {SEQUENCE_LENGTH} frames between markers")
    
    # Process the video and collect edge transitions
    edges = list(find_edges(video_file))
    
    # Print summary of collected edges
    if not edges:
        print("No edge transitions found in video")
        return

    print(f"\nCollected {len(edges)} edge transitions:")
    for frame_num, state in edges:
        print(f"  Frame {frame_num}: {state}")
    
    # Get midframes for high and low state intervals
    high_midframes = list(find_midframes(edges, True))
    low_midframes = list(find_midframes(edges, False))
    print(f"\nFound {len(high_midframes)} high state midframes: {high_midframes}")
    print(f"Found {len(low_midframes)} low state midframes: {low_midframes}")
    
    # Find magenta sequence
    sequence_frames = find_sequence(video_file, high_midframes)

    if not sequence_frames:
        print("No magenta sequence found!")
        return
    
    print(f"\nMagenta sequence found: {len(sequence_frames)} frames")
    print(f"Sequence frames: {sequence_frames}")
    
    # Process sub-sequences and get extracted frame numbers
    extracted_frames = process_subsequences(video_file, sequence_frames)
    
    # Extract dark frames ONLY for the frames that were extracted in sub-sequences
    if extracted_frames:
        extract_subsequence_dark_frames(video_file, extracted_frames, low_midframes)
    else:
        print("\nNo sub-sequence frames extracted, skipping dark frame extraction")


if __name__ == "__main__":
    main()
