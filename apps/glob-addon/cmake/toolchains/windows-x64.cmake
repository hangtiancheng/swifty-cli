set(CMAKE_SYSTEM_NAME Windows)
set(CMAKE_SYSTEM_PROCESSOR x86_64)

get_filename_component(_toolchain_dir "${CMAKE_CURRENT_LIST_FILE}" DIRECTORY)

set(CMAKE_C_COMPILER "${_toolchain_dir}/zig-cc.sh")
set(CMAKE_CXX_COMPILER "${_toolchain_dir}/zig-cxx.sh")
set(CMAKE_C_FLAGS_INIT "-target x86_64-windows-gnu")
set(CMAKE_CXX_FLAGS_INIT "-target x86_64-windows-gnu")

set(CMAKE_AR "${_toolchain_dir}/zig-ar.sh")
set(CMAKE_RANLIB "${_toolchain_dir}/zig-ranlib.sh")

set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
