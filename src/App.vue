<template>
  <div class="page">
    <div class="page-shell">
      <main class="main-layout">
        <div class="document-area">
          <!-- <h1>SuperDoc AI Tools</h1> -->
          <div id="superdoc-toolbar"></div>
          <div class="document-content">
              <div id="superdoc"></div>
                          <Sidebar
              :action-logs="actionLogs"
              :mode="mode"
              :is-dropdown-open="isDropdownOpen"
              :selected-action="selectedAction"
              :available-tools-count="availableToolsCount"
              :filtered-actions="filteredActions"
              :buttons-enabled="buttonsEnabled"
              :prompt="prompt"
              @update:mode="handleModeUpdate"
              @update:is-dropdown-open="isDropdownOpen = $event"
              @update:selected-action="selectedAction = $event"
              @update:prompt="prompt = $event"
              @execute-action="executeAction"
            />
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { SuperDoc } from 'superdoc'
import { AIActions } from '@superdoc-dev/ai'
import Sidebar from './components/Sidebar.vue'
import 'superdoc/style.css'
import './style.css'

const statusText = ref('Waiting for SuperDoc...')
const buttonsEnabled = ref(false)
const aiInstance = ref(null)
const prompt = ref('')
const isDropdownOpen = ref(false)
const actionLogs = ref([])
const mode = ref('prompt') // 'prompt' or 'tool'
let currentLogId = 0

const initialDocument = `
  <h1>SuperDoc AI Actions Overview</h1>
  <p>
    SuperDoc AI is the LLM bridge for SuperDoc editors, packaging provider management and document-context enrichment into one consistent API. It sits directly in the collaborative canvas so teams can call AI assistance the moment content is drafted.
  </p>
  <p>
  Launched on November 1st, 2025, this package seamlessly integrates search, rewriting, highlighting, tracked changes, comment insertion, and streaming completions to maintain editorial momentum. It transforms every SuperDoc workspace into an AI-powered collaborator, enabling teams to uncover insights, implement structured edits, and document feedback—all within a single environment. 
  </p>
  <p>
  The next milestone is to create a comprehensive demos and documentation, and proactively communicating changes to customers to ensure adoption feels effortless.
  </p>
`

async function handleOpenPrompt(_, prompt) {
  // Store reference to the original log entry at the start
  const originalLogId = actionLogs.value[actionLogs.value.length - 1]?.id

  // Build tools array from available actions (excluding openPrompt itself)
  const tools = availableActions.value
    .filter(action => action.key !== 'openPrompt')
    .map(action => ({
      type: "function",
      function: {
        name: action.key,
        description: action.description,
        parameters: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description: "The specific instruction or prompt for this action"
            }
          },
          required: ["prompt"]
        }
      }
    }))

  // Direct request to proxy for open prompt with function calling
  try {
    statusText.value = 'Processing open prompt...'
    updateCurrentLog({ status: 'Processing open prompt...' })
    
    const proxyUrl = import.meta.env.VITE_PROXY_URL
    if (!proxyUrl) {
      throw new Error('VITE_PROXY_URL not configured')
    }
    
    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: prompt }
        ],
        tools: tools,
        tool_choice: "auto",
        temperature: 0.7,
        max_tokens: 1000
      })
    })
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    
    const data = await response.json()
    const message = data.choices?.[0]?.message
    
    if (message?.tool_calls && message.tool_calls.length > 0) {
      // Handle function calls
      console.log('Function calls requested:', message.tool_calls)
      updateCurrentLog({ status: `Executing ${message.tool_calls.length} function call(s)...` })
      
      const toolResults = []
      for (let i = 0; i < message.tool_calls.length; i++) {
        const toolCall = message.tool_calls[i]
        const functionName = toolCall.function.name
        const args = JSON.parse(toolCall.function.arguments)
        
        // Find the corresponding action
        const action = availableActions.value.find(a => a.key === functionName)
        if (action && action.method) {
          try {
            // Create a separate log entry for each tool call
            addActionLog(action.label, args.prompt)
            
            console.log(`Executing ${functionName} with prompt:`, args.prompt)
            await action.method(aiInstance.value, args.prompt)
            
            // Update the tool's individual log entry
            updateCurrentLog({ status: 'Done.' })
            toolResults.push(`✓ ${action.label}: "${args.prompt}"`)
            
          } catch (error) {
            console.error(`Error executing ${functionName}:`, error)
            const errorMessage = error.message
            updateCurrentLog({ status: 'Error', error: errorMessage })
            toolResults.push(`✗ ${action.label}: Error - ${errorMessage}`)
          }
        } else {
          // Log the unknown tool
          addActionLog(functionName, args.prompt)
          updateCurrentLog({ status: 'Error', error: 'Tool not found' })
          toolResults.push(`✗ ${functionName}: Tool not found`)
        }
      }
      
      const result = `Function calls executed:\n${toolResults.join('\n')}`
      console.log('Open prompt result:', result)
      
      // Update the original Open Prompt log entry using the stored ID
      if (originalLogId) {
        const originalLogIndex = actionLogs.value.findIndex(log => log.id === originalLogId)
        if (originalLogIndex !== -1) {
          actionLogs.value[originalLogIndex].status = `All ${message.tool_calls.length} function calls completed.`
        }
      }
      
      return result
    } else {
      // Regular text response
      const result = message?.content || data.content || JSON.stringify(data)
      console.log('Open prompt result:', result)
      updateCurrentLog({ status: 'Open prompt completed.', fullResult: truncateText(String(result), 100) })
      return result
    }
  } catch (error) {
    console.error('Open prompt error:', error)
    
    // Update the original log entry with error
    if (originalLogId) {
      const originalLogIndex = actionLogs.value.findIndex(log => log.id === originalLogId)
      if (originalLogIndex !== -1) {
        actionLogs.value[originalLogIndex].status = 'Open prompt failed.'
        actionLogs.value[originalLogIndex].error = error.message
      }
    } else {
      updateCurrentLog({ status: 'Open prompt failed.', error: error.message })
    }
    
    throw error
  }
}

const actionsDictionary = {
  'openPrompt': { 
    label: 'Open Prompt', 
    description: 'Send a general AI prompt that can invoke other tools or provide general responses',
    method: handleOpenPrompt 
  },
  'find': { 
    label: 'Find', 
    description: 'Find the first occurrence of content in the document based on a search instruction',
    method: (ai, prompt) => ai.action.find(prompt) 
  },
  'findAll': { 
    label: 'Find All', 
    description: 'Find all occurrences of content in the document based on a search instruction',
    method: (ai, prompt) => ai.action.findAll(prompt) 
  },
  'highlight': { 
    label: 'Highlight', 
    description: 'Highlight specific text or sections in the document with optional color',
    method: (ai, prompt) => ai.action.highlight(prompt) 
  },
  'replace': { 
    label: 'Replace', 
    description: 'Replace the first occurrence of content in the document with new text',
    method: (ai, prompt) => ai.action.replace(prompt) 
  },
  'replaceAll': { 
    label: 'Replace All', 
    description: 'Replace all occurrences of content in the document with new text',
    method: (ai, prompt) => ai.action.replaceAll(prompt) 
  },
  'insertTrackedChange': { 
    label: 'Insert Tracked Change', 
    description: 'Insert a single tracked change or suggestion in the document for review',
    method: (ai, prompt) => ai.action.insertTrackedChange(prompt) 
  },
  'insertTrackedChanges': { 
    label: 'Insert Multiple Tracked Changes', 
    description: 'Insert multiple tracked changes or suggestions throughout the document',
    method: (ai, prompt) => ai.action.insertTrackedChanges(prompt) 
  },
  'insertComment': { 
    label: 'Insert Comment', 
    description: 'Add a single comment or annotation to a specific part of the document',
    method: (ai, prompt) => ai.action.insertComment(prompt) 
  },
  'insertComments': { 
    label: 'Insert Multiple Comments', 
    description: 'Add multiple comments or annotations throughout the document',
    method: (ai, prompt) => ai.action.insertComments(prompt) 
  },
  'summarize': { 
    label: 'Summarize', 
    description: 'Generate a summary of the document content or specific sections',
    method: (ai, prompt) => ai.action.summarize(prompt) 
  },
  'insertContent': { 
    label: 'Insert Content', 
    description: 'Insert new content, text, or sections into the document at appropriate locations',
    method: (ai, prompt) => ai.action.insertContent(prompt) 
  },
}

const availableActions = ref(
  Object.keys(actionsDictionary)
    .sort()
    .map(key => ({
      key,
      ...actionsDictionary[key]
    }))
)

const selectedAction = ref(
  mode.value === 'prompt' 
    ? availableActions.value.find(action => action.key === 'openPrompt')
    : availableActions.value.find(action => action.key !== 'openPrompt')
)

// Computed properties for the new interface
const availableToolsCount = computed(() => {
  return availableActions.value.filter(action => action.key !== 'openPrompt').length
})

const filteredActions = computed(() => {
  if (mode.value === 'prompt') {
    return availableActions.value.filter(action => action.key === 'openPrompt')
  } else {
    return availableActions.value.filter(action => action.key !== 'openPrompt')
  }
})

// Functions for mode switching
function handleModeUpdate(newMode) {
  mode.value = newMode
  
  if (newMode === 'prompt') {
    selectedAction.value = availableActions.value.find(action => action.key === 'openPrompt')
  } else {
    selectedAction.value = availableActions.value.find(action => action.key !== 'openPrompt')
  }
  
  isDropdownOpen.value = false
}

function truncateText(text, maxLength) {
  if (!text) return ''
  return text.length > maxLength ? text.substring(0, maxLength) + '...' : text
}

function addActionLog(action, prompt) {
  const log = {
    id: currentLogId++,
    action: action,
    prompt: prompt,
    status: 'Starting...',
    partialResult: null,
    fullResult: null,
    error: null
  }
  actionLogs.value.push(log)
  return log
}

function updateCurrentLog(updates) {
  if (actionLogs.value.length > 0) {
    const currentLog = actionLogs.value[actionLogs.value.length - 1]
    Object.assign(currentLog, updates)
  }
}

function initializeAI(superdoc) {
  if (aiInstance.value) {
    return aiInstance.value
  }

  const apiKey = import.meta.env.VITE_OPENAI_API_KEY
  const model = import.meta.env.VITE_OPENAI_MODEL || 'gpt-4o-mini'
  const proxyUrl = import.meta.env.VITE_PROXY_URL

  let provider
  if (proxyUrl) {
    provider = {
      type: 'http',
      url: proxyUrl,
      streamResults: true
    }
  } else {
    provider = {
      type: 'openai',
      apiKey,
      model,
      streamResults: true
    }
  }

  if (!apiKey && !proxyUrl) {
    statusText.value = 'Add VITE_OPENAI_API_KEY to .env then restart the dev server to enable AI actions.'
    return null
  }

  statusText.value = 'Connecting to OpenAI...'
  buttonsEnabled.value = false

  aiInstance.value = new AIActions(superdoc, {
    user: {
      displayName: 'SuperDoc AI Assistant',
      userId: 'ai-demo',
    },
    provider,
    enableLogging: false,
    onReady: () => {
      statusText.value = 'AI is ready. Select an action and enter a prompt.'
      buttonsEnabled.value = true
    },
    onStreamingStart: () => {
      statusText.value = 'AI is processing your request...'
      buttonsEnabled.value = false
      updateCurrentLog({ status: 'Processing...' })
    },
    onStreamingPartialResult: (context) => {
      statusText.value = 'AI is streaming results...'
      updateCurrentLog({ 
        status: 'Streaming...', 
        partialResult: truncateText(context.partialResult, 100) 
      })
    },
    onStreamingEnd: (context) => {
      statusText.value = 'AI completed successfully. Ready for next action.'
      buttonsEnabled.value = true
      updateCurrentLog({ 
        status: 'Done.', 
        fullResult: truncateText(String(context.fullResult), 100) 
      })
    },
    onError: (error) => {
      console.error(error)
      statusText.value = `Error: ${error.message}`
      buttonsEnabled.value = true
      updateCurrentLog({ 
        status: 'Error', 
        error: error.message 
      })
    }
  })

  aiInstance.value.waitUntilReady().catch((error) => {
    console.error(error)
    statusText.value = `AI failed to initialize: ${error.message}`
  })

  return aiInstance.value
}

async function executeAction() {
  if (!aiInstance.value) {
    statusText.value = 'AI is not ready yet. Add your API key and reload.'
    return
  }

  if (!prompt.value.trim()) {
    statusText.value = 'Please enter a prompt first.'
    return
  }

  // Store the prompt value before clearing it
  const promptToExecute = prompt.value

  // Create log entry for this action
  addActionLog(selectedAction.value.label, promptToExecute)
  
  // Clear the prompt immediately after starting execution
  prompt.value = ''
  
  buttonsEnabled.value = false

  try {
    await aiInstance.value.waitUntilReady()
    await selectedAction.value.method(aiInstance.value, promptToExecute)
  } catch (error) {
    console.error(error)
    statusText.value = `AI error: ${error.message}`
    updateCurrentLog({ 
      status: 'Error', 
      error: error.message 
    })
  } finally {
    buttonsEnabled.value = true
  }
}


function handleClickOutside(event) {
  const dropdown = event.target.closest('.dropdown-container')
  if (!dropdown) {
    isDropdownOpen.value = false
  }
}

onMounted(() => {
  const superdoc = new SuperDoc({
    selector: '#superdoc',
    documentMode: 'editing',
    pagination: true,
    rulers: true,
    toolbar: '#superdoc-toolbar',
    onEditorCreate: ({ editor }) => {
      editor?.commands?.insertContent?.(initialDocument)
      statusText.value = 'SuperDoc is ready. Initializing AI...'
      initializeAI(superdoc)
    }
  })

  buttonsEnabled.value = false
  
  // Add click outside listener for dropdown
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>