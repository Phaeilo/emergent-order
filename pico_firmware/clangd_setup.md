# clangd Setup for Pico SDK

## Steps to configure clangd:

1. Generate compilation database:
   ```bash
   cmake -S . -B build -DCMAKE_EXPORT_COMPILE_COMMANDS=ON
   ```

2. Symlink to project root:
   ```bash
   ln -sf build/compile_commands.json compile_commands.json
   ```

3. Create `.clangd` config file with ARM target flags

4. Restart LSP/editor

## Files created:
- `compile_commands.json` (symlink)
- `.clangd` (config for ARM cross-compilation)

## Maintenance:
- `compile_commands.json` auto-regenerates on each cmake configure
- Restart LSP after regenerating build files
