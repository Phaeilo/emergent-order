# Cube Calibration Utils

Tools for recovering 3D LED positions from the chaotic LED cube installation.

## Overview

This calibration system uses a ternary color-coded identification scheme where LEDs flash specific color sequences that encode their unique IDs. Multiple camera perspectives capture these sequences, and the 2D detections are triangulated to recover 3D positions.

## Tools

### frame_extractor.py
Automated video processing tool that extracts calibration frames from video recordings.

**What it does:**
- Analyzes video frame-by-frame to detect brightness changes
- Identifies calibration sequences by detecting magenta color markers
- Extracts frames between magenta markers (configurable sequence length, default: 9 frames)
- Extracts corresponding dark frames for background subtraction
- Saves extracted frames as PNG files with structured naming

**Usage:**
```bash
uv run frame_extractor.py video.mp4
```

**Output:** PNG files named `{video_name}_subseq_{N}_{frame_number}.png` and `{video_name}_subseq_{N}_{frame_number}_dark.png`

### led_detector.html (+ .js + .css)
Modern web-based LED detector with real-time visual feedback.

**What it does:**
- Loads image sequences from a single camera perspective
- Performs background subtraction using dark frames
- Classifies pixel colors as Red, Green, Blue, or White
- Decodes ternary LED IDs from color sequences
- Validates LED IDs using checksum
- Computes LED centroid positions
- Exports results as text files

**Usage:**
Open `led_detector.html` in a web browser, drag and drop images (including dark frame and optional mask frame).

**Output format:**
```
FRAME_SIZE width height
LED_subseq_id x y
LED_subseq_id x y
...
```

### led_detector_sequenced.py
Command-line Python LED detector (legacy, less convenient than HTML version).

**What it does:**
Same functionality as HTML version but controlled via command-line arguments and environment variables.

**Usage:**
```bash
LOG_LEVEL=INFO DEBUG_OUTPUT=1 uv run led_detector_sequenced.py images/*.png
```

**Environment variables:**
- `LOG_LEVEL`: Logging verbosity (DEBUG, INFO, WARNING, ERROR)
- `DEBUG_OUTPUT`: Set to "1" to generate debug images

**Output:** Writes results to stdout, debug images if enabled

### rename_video.py
Simple utility for batch renaming video files (no external dependencies).

**What it does:**
Renames Google Pixel video files (format: `PXL_*.mp4`) to simple sequential names (`a.mp4`, `b.mp4`, `c.mp4`, etc.).

**Usage:**
```bash
./rename_video.py [directory]
```

If no directory is specified, operates on current directory.

### led_solver.py
3D reconstruction tool that triangulates LED positions from multiple camera perspectives.

**What it does:**
- Loads 2D LED observations from multiple cameras
- Performs camera calibration (estimates camera poses)
- Triangulates 3D LED positions using multiple views
- Applies bundle adjustment optimization
- Implements robust outlier rejection:
  - Statistical outlier detection (MAD-based)
  - RANSAC for camera pose estimation
  - Reprojection error validation
  - Iterative refinement
- Generates 3D visualization

**Usage:**
```bash
uv run led_solver.py camera1.txt camera2.txt camera3.txt --output solution.txt --viz visualization.html
```

**Optional arguments:**
- `--output`, `-o`: Output file for 3D LED positions
- `--viz`, `-v`: Generate HTML visualization
- `--top`: Comma-separated LED IDs near top (for orientation)
- `--bottom`: LED IDs near bottom
- `--left`: LED IDs near left
- `--right`: LED IDs near right

**Output format:**
```
LED_0000 -0.032561 0.357653 -0.102755
LED_0001 0.123456 -0.234567 0.345678
LED_0002 0.987654 0.654321 -0.123456
...
```
The solver may also output additional metadata and statistics as comments (lines starting with `#`).

## Full Calibration Workflow

### 1. Display Calibration Pattern
Run the calibration pattern on your LED installation. The pattern should:
- Flash magenta at the start and end of each sequence to mark boundaries
- Display 9 color frames (Red/Green/Blue) encoding LED IDs in ternary (see "LED ID Encoding Scheme" section below)
- Include dark frames (all LEDs off) between lit frames for background subtraction
- Allow enough time between color transitions for camera exposure (aim for 3-5 lit frames per color state)

### 2. Capture Videos
Record videos from multiple angles with consistent settings.

**Tested Configuration:**
- **Camera**: Google Pixel 9 Pro
- **Resolution**: 4K 60fps
- **Zoom**: 1x (no zoom)

**Critical Camera Settings:**
- **Fixed exposure** (lowest setting) - prevents LED overexposure and maintains consistency
- **Fixed color temperature** - ensures consistent color interpretation across frames
- **Fixed focus** - re-establish for each camera position, but don't change during recording
- **Ambient light** - provides context for the scene (will be removed via dark frame subtraction)
  - If LEDs are the only light source, color decoding may be unreliable

**Capture Guidelines:**
- Use a tripod for stability
- Capture at least 6+ perspectives for best results
- Vary camera angles significantly between captures
- Vary camera height - don't stay at ground level
- Ensure each camera can see a large portion of the cube (though close-up shots that capture smaller sections are also acceptable and can improve local accuracy)
- Avoid reflections in the environment, or mask them in post-processing
- Record one complete calibration sequence per perspective
- Don't move the cube or LEDs between captures

### 3. Rename and Extract Frames
```bash
# Rename video files for convenience (no dependencies, can run directly)
./rename_video.py /path/to/videos/

# Extract frames from each video
uv run frame_extractor.py a.mp4
uv run frame_extractor.py b.mp4
uv run frame_extractor.py c.mp4
# ... etc for each video
```

This produces frame files like:
```
a_subseq_01_0167_dark.png    (dark/background frame)
a_subseq_01_0179.png         (ternary digit 0)
a_subseq_01_0203.png         (ternary digit 1)
...
a_subseq_01_0324.png         (ternary digit 8)
```

### 4. Detect LED Positions
For each set of extracted frames:

1. Open `led_detector.html` in a web browser
2. Drag and drop all frames from one camera perspective (including dark frame)
3. Adjust parameters if needed:
   - **Brightness threshold**: Increase if too many false detections, decrease if missing LEDs
   - **Color purity**: Higher values require purer colors (reduces crosstalk)
   - **Green correction**: Adjust if greens appear blue/cyan
   - **Min pixels per LED**: Filter out small noise artifacts
4. Use masks to exclude reflections or unwanted regions
5. Verify detection quality using visualization modes
6. Click download button to save results
7. Save with consistent naming (e.g., `perspective_0.txt`, `perspective_1.txt`, ...)
8. Repeat for each camera perspective

### 5. Triangulate 3D Positions
```bash
uv run led_solver.py perspective_0.txt perspective_1.txt perspective_2.txt perspective_3.txt perspective_4.txt perspective_5.txt \
    --output led_positions_3d.txt \
    --viz led_positions_3d.html \
    --top 42,17 \
    --bottom 8,99
```

**Tips:**
- Use 6+ perspectives for robust reconstruction
- Provide spatial hints (top/bottom/left/right) if you know some LED positions - helps with orientation
- Check the HTML visualization for obvious errors
- Review rejection statistics to identify problematic cameras or LEDs
- If results are poor, try `--conservative` mode or add more camera angles

### 6. Verify Results
- Open the generated HTML visualization in a browser
- Rotate and inspect the 3D point cloud
- Check that the shape matches your physical installation
- Verify that LED IDs are reasonable and sequential
- Check solver statistics for high rejection rates (may indicate camera or detection issues)

**Note:** You may not achieve 100% calibration of all LEDs. A few "dead pixels" (heavily occluded, hidden, or failed detections) are acceptable. Animation software will set missing LEDs to black.

## LED ID Encoding Scheme

### Ternary Encoding
LEDs identify themselves by flashing a sequence of colors that encode their ID in ternary (base-3):

- **Red** = 0
- **Green** = 1
- **Blue** = 2
- **Least significant digit first** (right-to-left in conventional notation)

### Checksum Validation
To detect transmission errors, LED IDs include a built-in checksum:

1. The raw decoded ternary value must be divisible by 7 (i.e., `value % 7 == 0`)
2. If validation passes, divide by 9 to get the true LED ID: `true_id = value // 9`

### Encoding Example (Python)
```python
def encode_led_id(led_id: int, num_digits: int = 9) -> str:
    """Encode LED ID into ternary color sequence with checksum"""
    # Add checksum: multiply by 9, then add offset to ensure divisible by 7
    n = led_id * 9
    n = n + (7 - (n % 7))

    # Convert to ternary (LSB first)
    colors = []
    for _ in range(num_digits):
        digit = n % 3
        n = n // 3
        colors.append('RGB'[digit])

    return ''.join(colors)

def decode_led_id(color_sequence: str) -> int:
    """Decode ternary color sequence to LED ID, returns -1 if invalid"""
    # Decode ternary (LSB first)
    value = 0
    for i, color in enumerate(color_sequence):
        try:
            digit = 'RGB'.index(color)
        except ValueError:
            return -1  # Invalid color
        value += digit * (3 ** i)

    # Validate checksum
    if value % 7 != 0:
        return -1

    # Extract true ID
    true_id = value // 9
    return true_id

def generate_calibration_pattern(led_id: int, num_digits: int = 9) -> str:
    """Generate looping calibration pattern: M_C_C_..._C_ (M=magenta, _=dark, C=color)"""
    # Encode the LED ID to get color sequence
    color_sequence = encode_led_id(led_id, num_digits)

    # Build the pattern: start with magenta marker
    pattern = ['M', '_']

    # Add each color frame followed by a dark frame
    for color in color_sequence:
        pattern.append(color)
        pattern.append('_')

    # Pattern loops back to magenta marker (no explicit end marker needed)
    return ''.join(pattern)
```

### Example
For LED ID `1` with 9 digits:
- Base value: `1 * 9 = 9`
- Checksum offset: `7 - (9 % 7) = 7 - 2 = 5`
- Final value: `9 + 5 = 14`
- Verify: `14 % 7 = 0` ✓ (valid checksum)
- Decode check: `14 // 9 = 1` ✓ (recovers original ID)
- Ternary representation: `14 = 112` in base 3 (LSB first: 2, 1, 1)
- Color sequence: `BGGRRRRRR` (padded to 9 digits, R=0, G=1, B=2)
- Full calibration pattern: `M_B_G_G_R_R_R_R_R_R_` (20 frames, then loops)
  - Frame 1: Magenta (start marker)
  - Frame 2: Dark
  - Frame 3: Blue (digit 0 = 2)
  - Frame 4: Dark
  - Frame 5: Green (digit 1 = 1)
  - Frame 6: Dark
  - ... (continues for all 9 color frames with dark frames between)
  - Frame 19: Red (digit 8 = 0)
  - Frame 20: Dark
  - (Pattern loops back to frame 1 - next magenta serves as sequence boundary)

## License

MIT License
