# Download Node.js headers for cross-compilation targets.
#
# Usage:
#   cmake -DNODE_VERSION=v22.16.0 -DTARGET_PLATFORM=linux -DTARGET_ARCH=arm64 \
#         -P cmake/download-node-headers.cmake
#
# Headers are cached under cmake/node-headers/<version>/<platform>-<arch>/

if(NOT DEFINED NODE_VERSION)
  execute_process(
    COMMAND node -p "process.version"
    OUTPUT_VARIABLE NODE_VERSION
    OUTPUT_STRIP_TRAILING_WHITESPACE
  )
endif()

if(NOT DEFINED TARGET_PLATFORM)
  message(FATAL_ERROR "TARGET_PLATFORM must be set (darwin, linux, win)")
endif()

if(NOT DEFINED TARGET_ARCH)
  message(FATAL_ERROR "TARGET_ARCH must be set (arm64, x64)")
endif()

get_filename_component(SCRIPT_DIR "${CMAKE_CURRENT_LIST_DIR}" ABSOLUTE)
set(HEADERS_DIR "${SCRIPT_DIR}/node-headers/${NODE_VERSION}/${TARGET_PLATFORM}-${TARGET_ARCH}")

if(NOT EXISTS "${HEADERS_DIR}/include/node/node_api.h")
  set(TARBALL "node-${NODE_VERSION}-headers.tar.gz")
  set(URL "https://nodejs.org/download/release/${NODE_VERSION}/${TARBALL}")
  set(DOWNLOAD_PATH "${HEADERS_DIR}/${TARBALL}")

  message(STATUS "Downloading Node.js ${NODE_VERSION} headers from ${URL}")
  file(MAKE_DIRECTORY "${HEADERS_DIR}")
  file(DOWNLOAD "${URL}" "${DOWNLOAD_PATH}" STATUS download_status SHOW_PROGRESS)

  list(GET download_status 0 status_code)
  if(NOT status_code EQUAL 0)
    file(REMOVE "${DOWNLOAD_PATH}")
    message(FATAL_ERROR "Download failed: ${download_status}")
  endif()

  message(STATUS "Extracting headers to ${HEADERS_DIR}")
  execute_process(
    COMMAND ${CMAKE_COMMAND} -E tar xzf "${DOWNLOAD_PATH}"
    WORKING_DIRECTORY "${HEADERS_DIR}"
    RESULT_VARIABLE extract_result
  )

  if(NOT extract_result EQUAL 0)
    file(REMOVE "${DOWNLOAD_PATH}")
    message(FATAL_ERROR "Extraction failed")
  endif()

  file(REMOVE "${DOWNLOAD_PATH}")
  message(STATUS "Node.js headers ready: ${HEADERS_DIR}/node-${NODE_VERSION}/include/node")
else()
  message(STATUS "Node.js headers already present: ${HEADERS_DIR}")
endif()

# Windows targets also need node.lib (import library for N-API symbols)
if(TARGET_PLATFORM STREQUAL "win")
  set(NODE_LIB_PATH "${HEADERS_DIR}/node-${NODE_VERSION}/lib/node.lib")
  if(NOT EXISTS "${NODE_LIB_PATH}")
    set(LIB_URL "https://nodejs.org/download/release/${NODE_VERSION}/win-${TARGET_ARCH}/node.lib")
    message(STATUS "Downloading node.lib from ${LIB_URL}")
    file(MAKE_DIRECTORY "${HEADERS_DIR}/node-${NODE_VERSION}/lib")
    file(DOWNLOAD "${LIB_URL}" "${NODE_LIB_PATH}" STATUS lib_status SHOW_PROGRESS)
    list(GET lib_status 0 lib_code)
    if(NOT lib_code EQUAL 0)
      file(REMOVE "${NODE_LIB_PATH}")
      message(FATAL_ERROR "node.lib download failed: ${lib_status}")
    endif()
  endif()
  message(STATUS "node.lib ready: ${NODE_LIB_PATH}")
endif()
