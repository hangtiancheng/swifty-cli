# Shared Zig toolchain setup.
# Include after setting CMAKE_SYSTEM_NAME, CMAKE_SYSTEM_PROCESSOR and ZIG_TARGET.

set(CMAKE_C_COMPILER zig cc)
set(CMAKE_CXX_COMPILER zig c++)
set(CMAKE_C_FLAGS_INIT "-target ${ZIG_TARGET}")
set(CMAKE_CXX_FLAGS_INIT "-target ${ZIG_TARGET}")

# CMake >= 3.27 asks the linker to emit link dependencies via
# --dependency-file, which zig's lld does not support.
set(CMAKE_LINK_DEPENDS_USE_LINKER FALSE)

set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
