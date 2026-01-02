#!/bin/bash

# Enhanced build script for Pico firmware projects
# Usage: ./build.sh [OPTIONS] [TARGET]
#
# Options:
#   --clean         Perform a clean build (removes build directory)
#   --upload        Upload firmware to Pico after successful build (requires picotool)
#   --help, -h      Show this help message
#
# Targets:
#   wsproxy         WS2812 Proxy firmware (default)
#
# Examples:
#   ./build.sh                     # Incremental build of wsproxy
#   ./build.sh --clean             # Clean build of wsproxy
#   ./build.sh --upload            # Build and upload wsproxy
#   ./build.sh --clean --upload    # Clean build and upload

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
CLEAN_BUILD=false
UPLOAD=false
TARGET="wsproxy"

# Print colored message
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Show help
show_help() {
    cat << EOF
Enhanced build script for Pico firmware projects

Usage: $0 [OPTIONS] [TARGET]

Options:
  --clean         Perform a clean build (removes build directory)
  --upload        Upload firmware to Pico after successful build (requires picotool)
  --help, -h      Show this help message

Targets:
  wsproxy         WS2812 Proxy firmware (default)

Examples:
  $0                              # Incremental build of wsproxy
  $0 --clean                      # Clean build of wsproxy
  $0 --upload                     # Build and upload wsproxy
  $0 --clean --upload             # Clean build and upload

EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --clean)
            CLEAN_BUILD=true
            shift
            ;;
        --upload)
            UPLOAD=true
            shift
            ;;
        --help|-h)
            show_help
            exit 0
            ;;
        wsproxy)
            TARGET=$1
            shift
            ;;
        *)
            print_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Print build configuration
echo ""
echo "======================================"
echo "  Pico Firmware Build Script"
echo "======================================"
print_info "Target: $TARGET"
print_info "Clean build: $CLEAN_BUILD"
print_info "Upload after build: $UPLOAD"
echo ""

# Check if picotool is available when upload is requested
if [ "$UPLOAD" = true ]; then
    if ! command -v picotool &> /dev/null; then
        print_error "picotool not found! Install it to use --upload option"
        exit 1
    fi
fi

# Clean build if requested
if [ "$CLEAN_BUILD" = true ]; then
    print_info "Removing build directory..."
    rm -rf build/
    print_success "Build directory cleaned"
fi

# Configure CMake if build directory doesn't exist
if [ ! -d "build" ]; then
    print_info "Configuring CMake..."
    cmake -S . -B build -DPICO_BOARD=pico_w -DCMAKE_EXPORT_COMPILE_COMMANDS=ON
    print_success "CMake configuration complete"
else
    print_info "Using existing build configuration (use --clean for fresh build)"
fi

# Build target
echo ""
print_info "Building $TARGET..."
cmake --build build --target "$TARGET"
print_success "$TARGET built successfully"

# Show build artifacts
echo ""
print_info "Build artifacts:"
if [ -f "build/${TARGET}.uf2" ]; then
    echo "  - build/${TARGET}.uf2"
fi

# Upload if requested
if [ "$UPLOAD" = true ]; then
    UF2_FILE="build/${TARGET}.uf2"

    if [ ! -f "$UF2_FILE" ]; then
        print_error "UF2 file not found: $UF2_FILE"
        exit 1
    fi

    echo ""
    print_info "Uploading $UF2_FILE to Pico..."
    if picotool load -f -x "$UF2_FILE"; then
        print_success "Firmware uploaded and running!"
    else
        print_error "Upload failed!"
        exit 1
    fi
fi

echo ""
print_success "Build complete!"
echo ""
