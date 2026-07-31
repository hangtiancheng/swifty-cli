swifty-cli.code-workspace

```json
{
  "folders": [
    {
      "name": "swifty-cli",
      "path": "./"
    },
    {
      "name": "reference",
      "path": "/Users/whoami/Downloads/reference"
    }
  ]
}
```

```bash
brew install scc tokei
scc .
tokei .

alias swifty="$HOME/github/swifty-cli/apps/swifty/dist/main.js"
alias swiftx="$HOME/github/swifty.go/swiftx/build/swiftx-darwin-arm64"
alias larky="$HOME/github/swifty-cli/apps/larky/dist/cli/main.js"

# Supports: --uninstall, --version vX.Y.Z, --alpha, --beta, --rc, --canary, --nightly, --tag=NAME

curl -fsSL https://raw.githubusercontent.com/hangtiancheng/swifty-cli/main/install.sh | bash
curl -fsSL https://raw.githubusercontent.com/hangtiancheng/swifty-cli/main/install.sh | bash -s -- --alpha

curl -fsSL https://raw.githubusercontent.com/hangtiancheng/swifty-cli/main/larky.sh | bash
curl -fsSL https://raw.githubusercontent.com/hangtiancheng/swifty-cli/main/larky.sh | bash -s -- --alpha

curl -fsSL https://raw.githubusercontent.com/hangtiancheng/swifty-cli/main/swiftx.sh | bash
curl -fsSL https://raw.githubusercontent.com/hangtiancheng/swifty-cli/main/swiftx.sh | bash -s -- --alpha
```
