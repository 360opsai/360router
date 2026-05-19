# Third-Party Notices — 360router

This document contains required attributions for third-party open-source
software incorporated into 360router.

---

## Runtime Dependencies (npm packages)

| Package | License | Repository |
|---|---|---|
| `@anthropic-ai/sdk` | MIT | https://github.com/anthropics/anthropic-sdk-node |
| `@google/generative-ai` | Apache 2.0 | https://github.com/google/generative-ai-js |
| `boxen` | MIT | https://github.com/sindresorhus/boxen |
| `chalk` | MIT | https://github.com/chalk/chalk |
| `conf` | MIT | https://github.com/sindresorhus/conf |
| `cors` | MIT | https://github.com/expressjs/cors |
| `express` | MIT | https://github.com/expressjs/express |
| `groq-sdk` | Apache 2.0 | https://github.com/groq/groq-typescript |
| `inquirer` | MIT | https://github.com/SBoudrias/Inquirer.js |
| `openai` | Apache 2.0 | https://github.com/openai/openai-node |
| `ora` | MIT | https://github.com/sindresorhus/ora |

The full text of the MIT License and Apache License 2.0 are reproduced below.

---

## Native Engine — llama.cpp

360router optionally downloads and runs the `llama-server` binary from the
**llama.cpp** project, available at https://github.com/ggml-org/llama.cpp.

The binary is fetched on first run from the official llama.cpp GitHub Releases
page and cached locally at `~/.360router/engine/`. It is **not bundled** with
the 360router npm package or binary distribution.

### llama.cpp License

```
MIT License

Copyright (c) 2023-2024 The ggml authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Native Engine — Classification Model (Llama 3.2 1B Instruct)

360router optionally downloads the `Meta-Llama-3.2-1B-Instruct.Q4_K_M.gguf`
model from Hugging Face (quantized by QuantFactory) for local request
classification. The model is fetched on first run and cached locally at
`~/.360router/engine/`. It is **not bundled** with the 360router distribution.

**Original model:** Meta Llama 3.2 1B Instruct  
**License:** Meta Llama 3 Community License  
**License URL:** https://llama.meta.com/llama3/license/

The Meta Llama 3 Community License permits use for research and commercial
purposes subject to the terms at the URL above. Usage of this model is your
responsibility; please review Meta's terms before using 360router's native
engine in production.

**Quantization by:** QuantFactory (https://huggingface.co/QuantFactory)  
**Quantization method:** GGUF Q4_K_M  

---

## MIT License (full text)

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Apache License 2.0 (full text)

```
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

---

*This file was generated as part of 360opsAI LLC's open-source compliance
process for the 360router package (https://www.npmjs.com/package/360router).*
