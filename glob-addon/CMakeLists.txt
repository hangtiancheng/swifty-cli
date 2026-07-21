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
set(CMAKE_GENERATOR Ninja)

# MacOS, Linux
set(CMAKE_C_COMPILER clang)
set(CMAKE_CXX_COMPILER clang++)

set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Find Node.js include path
execute_process(
  COMMAND node -p "process.execPath.replace('/bin/node', '/include/node')"
  OUTPUT_VARIABLE NODE_INCLUDE_DIR
  OUTPUT_STRIP_TRAILING_WHITESPACE
)

include_directories(
  ${NODE_INCLUDE_DIR}
  ${CMAKE_SOURCE_DIR}/node_modules/node-addon-api
)

add_definitions(-DNAPI_DISABLE_CPP_EXCEPTIONS)

# clang-format
find_program(CLANG_FORMAT_EXE NAMES clang-format)
file(GLOB_RECURSE SOURCE_FILES
  "${CMAKE_SOURCE_DIR}/src/*.h"
  "${CMAKE_SOURCE_DIR}/src/*.cc"
)

if(CLANG_FORMAT_EXE)
  add_custom_target(format
    COMMAND ${CLANG_FORMAT_EXE} -i -style=google ${SOURCE_FILES}
    WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
    COMMENT "clang-format -i -style=google ${SOURCE_FILES}"
  )
else()
  message(WARNING "clang-format not found")
endif()

# Addon target (for IDE support only, actual build uses node-gyp)
add_library(addon SHARED src/addon.cc)
set_target_properties(addon PROPERTIES
  PREFIX ""
  SUFFIX ".node"
)

if(APPLE)
  set_target_properties(addon PROPERTIES
    LINK_FLAGS "-undefined dynamic_lookup"
  )
endif()

# Linux: link stdc++fs if needed (GCC < 9)
if(UNIX AND NOT APPLE)
  find_library(STDCPPFS_LIBRARY stdc++fs)
  if(STDCPPFS_LIBRARY)
    target_link_libraries(addon ${STDCPPFS_LIBRARY})
  endif()
endif()
