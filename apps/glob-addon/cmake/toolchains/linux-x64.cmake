set(CMAKE_SYSTEM_NAME Linux)
set(CMAKE_SYSTEM_PROCESSOR x86_64)

get_filename_component(_toolchain_dir "${CMAKE_CURRENT_LIST_FILE}" DIRECTORY)

set(CMAKE_C_COMPILER "${_toolchain_dir}/zig-cc.sh")
set(CMAKE_CXX_COMPILER "${_toolchain_dir}/zig-cxx.sh")
set(CMAKE_C_FLAGS_INIT "-target x86_64-linux-gnu")
set(CMAKE_CXX_FLAGS_INIT "-target x86_64-linux-gnu")

set(CMAKE_LINK_DEPENDS_USE_FILE NO)

set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
