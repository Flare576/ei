#!/bin/sh

models=(
  "local:gemma-3-4b-it"
  "local:qwen-3b-intent-microplan-v2"
  "local:ministral-3-3b-reasoning-2512"
  "local:microsoft/phi-4"
  "local:qwen/qwen3-30b-a3b-2507"
  "local:openai/gpt-oss-20b"
)
# local:liquid/lfm2.5-1.2b
# local:gemma-3n-e4b-it-absolute-heresy-imatrix
# local:deepseek/deepseek-r1-0528-qwen3-8b
# local:qwen/qwen3-14b

function tryNow() {
  sysPrompt="tests/model/prompts/$1"
  userPrompt="tests/model/prompts/$2"
  testCode="tests/model/validators/$3.ts"
  name="$4"
  cd ../..
  for model in "${models[@]}"
  do
    npm run bench -- \
      --system "$sysPrompt" \
      --user "$userPrompt" \
      --model "$model" \
      --name "$name" \
      --runs 20 \
      --validator "$testCode"
  done
  sleep 65
}

#tryNow "fastScan/system_03_fact.md" "fastScan/user_03_fact.md" "facts-03" "fact-only"
tryNow "fastScan/system_03_trait.md" "fastScan/user_03_trait.md" "traits-03" "trait-only"
#tryNow "fastScan/system_03_people.md" "fastScan/user_03_people.md" "people-03" "people-only"
#tryNow "fastScan/system_03_topic.md" "fastScan/user_03_topic.md" "topics-03" "topic-only"
