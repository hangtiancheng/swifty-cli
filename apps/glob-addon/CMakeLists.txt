# Copyright (c) 2026 hangtiancheng
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

cmake_minimum_required(VERSION 3.15)

project(addon VERSION 0.1.0)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# ---------------------------------------------------------------------------
# Cross-compilation support
#
# Native build (no toolchain file):
#   cmake -S . -B build
#
# Cross build (with toolchain file):
#   cmake -S . -B build-linux-arm64 \
#     -DCMAKE_TOOLCHAIN_FILE=cmake/toolchains/linux-arm64.cmake \
#     -DNODE_HEADERS_DIR=cmake/node-headers/v22.16.0/linux-arm64/node-v22.16.0/include/node
#
# Download headers first:
#   cmake -DNODE_VERSION=v22.16.0 -DTARGET_PLATFORM=linux -DTARGET_ARCH=arm64 \
#     -P cmake/download-node-headers.cmake
# ---------------------------------------------------------------------------

# Node.js headers: use NODE_HEADERS_DIR if provided, otherwise detect locally
if(DEFINED NODE_HEADERS_DIR)
  set(NODE_INCLUDE_DIR "${NODE_HEADERS_DIR}")
else()
  execute_process(
    COMMAND node -p "process.execPath.replace(/bin.node$/, 'include/node')"
    OUTPUT_VARIABLE NODE_INCLUDE_DIR
    OUTPUT_STRIP_TRAILING_WHITESPACE
  )
endif()

if(NOT EXISTS "${NODE_INCLUDE_DIR}/node_api.h")
  message(FATAL_ERROR
    "Node.js headers not found at: ${NODE_INCLUDE_DIR}\n"
    "For cross-compilation, download headers first:\n"
    "  cmake -DNODE_VERSION=v22.16.0 -DTARGET_PLATFORM=<platform> -DTARGET_ARCH=<arch> "
    "-P cmake/download-node-headers.cmake\n"
    "Then pass -DNODE_HEADERS_DIR=<path-to-headers>")
endif()

# node-addon-api location
if(EXISTS "${CMAKE_SOURCE_DIR}/node_modules/node-addon-api")
  set(NAPI_DIR "${CMAKE_SOURCE_DIR}/node_modules/node-addon-api")
else()
  execute_process(
    COMMAND node -p "require.resolve('node-addon-api')"
    OUTPUT_VARIABLE NAPI_RESOLVED
    OUTPUT_STRIP_TRAILING_WHITESPACE
  )
  get_filename_component(NAPI_DIR "${NAPI_RESOLVED}" DIRECTORY)
endif()

include_directories(
  ${NODE_INCLUDE_DIR}
  ${NAPI_DIR}
)

add_definitions(-DNAPI_DISABLE_CPP_EXCEPTIONS)

# ---------------------------------------------------------------------------
# clang-format (native builds only)
# ---------------------------------------------------------------------------
if(NOT CMAKE_CROSSCOMPILING)
  find_program(CLANG_FORMAT_EXE NAMES clang-format)
  file(GLOB_RECURSE FORMAT_SOURCE_FILES
    "${CMAKE_SOURCE_DIR}/src/*.h"
    "${CMAKE_SOURCE_DIR}/src/*.cc"
  )
  if(CLANG_FORMAT_EXE)
    add_custom_target(format
      COMMAND ${CLANG_FORMAT_EXE} -i -style=google ${FORMAT_SOURCE_FILES}
      WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
      COMMENT "clang-format -i -style=google"
    )
  endif()
endif()

# ---------------------------------------------------------------------------
# Addon target
# ---------------------------------------------------------------------------
add_library(addon SHARED src/addon.cc)
set_target_properties(addon PROPERTIES
  PREFIX ""
  SUFFIX ".node"
)

# Platform-specific link flags
if(CMAKE_SYSTEM_NAME STREQUAL "Darwin")
  set_target_properties(addon PROPERTIES
    LINK_FLAGS "-undefined dynamic_lookup"
  )
elseif(CMAKE_SYSTEM_NAME STREQUAL "Windows")
  if(NOT DEFINED NODE_LIB_DIR)
    message(FATAL_ERROR "NODE_LIB_DIR must be set for Windows builds (directory containing node.lib)")
  endif()
  target_link_libraries(addon "${NODE_LIB_DIR}/node.lib")
elseif(CMAKE_SYSTEM_NAME STREQUAL "Linux")
  # lld (used by zig) allows undefined symbols in shared libraries by default
endif()

# ---------------------------------------------------------------------------
# Output directory: prebuilds/<platform>-<arch>/
# ---------------------------------------------------------------------------
if(CMAKE_CROSSCOMPILING)
  string(TOLOWER "${CMAKE_SYSTEM_NAME}" _platform)
  string(TOLOWER "${CMAKE_SYSTEM_PROCESSOR}" _arch)
  if(_arch STREQUAL "aarch64")
    set(_arch "arm64")
  endif()
  set_target_properties(addon PROPERTIES
    LIBRARY_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/prebuilds/${_platform}-${_arch}"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/prebuilds/${_platform}-${_arch}"
  )
endif()
