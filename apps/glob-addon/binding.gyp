{
  "targets": [
    {
      "target_name": "glob_addon",
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "sources": ["src/addon.cc"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "cflags_cc": ["-std=c++17"],
      "conditions": [
        [
          "OS=='mac'",
          {
            "xcode_settings": {
              "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
              "CLANG_CXX_LANGUAGE_STANDARD": "c++17"
            }
          }
        ],
        [
          "OS=='win'",
          {
            "msvs_settings": {
              "VCCLCompilerTool": {
                "ExceptionHandling": 1,
                "AdditionalOptions": ["/std:c++17", "/utf-8"]
              }
            }
          }
        ]
      ]
    }
  ]
}
