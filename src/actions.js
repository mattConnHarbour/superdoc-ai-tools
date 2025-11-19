// Helper function for text truncation
function truncateText(text, maxLength) {
  if (!text) return ''
  return text.length > maxLength ? text.substring(0, maxLength) + '...' : text
}

// Build tools array for OpenAI function calling
function buildToolsArray(availableActions) {
  const convertToOpenAITool = action => ({
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
  })
  
  // Since openPrompt is no longer in availableActions, we don't need to filter it out
  return availableActions.value.map(convertToOpenAITool)
}

// Make API request to proxy
async function callOpenAI(prompt, tools) {
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
      messages: [{ role: 'user', content: prompt }],
      tools: tools,
      tool_choice: "auto",
      temperature: 0.7,
      max_tokens: 1000
    })
  })
  
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }
  
  return await response.json()
}

// Execute a single tool call
async function executeToolCall(toolCall, availableActions, aiInstance, addActionLog, updateCurrentLog) {
  const functionName = toolCall.function.name
  const args = JSON.parse(toolCall.function.arguments)
  
  const action = availableActions.value.find(a => a.key === functionName)
  
  if (!action?.method) {
    addActionLog(functionName, args.prompt)
    updateCurrentLog({ status: 'Error', error: 'Tool not found' })
    return `✗ ${functionName}: Tool not found`
  }
  
  try {
    addActionLog(action.label, args.prompt)
    console.log(`Executing ${functionName} with prompt:`, args.prompt)
    
    await action.method(aiInstance.value, args.prompt)
    
    updateCurrentLog({ status: 'Done.' })
    return `✓ ${action.label}: "${args.prompt}"`
    
  } catch (error) {
    console.error(`Error executing ${functionName}:`, error)
    updateCurrentLog({ status: 'Error', error: error.message })
    return `✗ ${action.label}: Error - ${error.message}`
  }
}

// Execute all tool calls
async function executeToolCalls(toolCalls, availableActions, aiInstance, addActionLog, updateCurrentLog) {
  const results = []
  
  for (const toolCall of toolCalls) {
    const result = await executeToolCall(toolCall, availableActions, aiInstance, addActionLog, updateCurrentLog)
    results.push(result)
  }
  
  return results
}

// Update original log entry with completion status
function updateOriginalLog(originalLogId, actionLogs, toolCallsCount) {
  if (!originalLogId) return
  
  const originalLogIndex = actionLogs.value.findIndex(log => log.id === originalLogId)
  if (originalLogIndex !== -1) {
    actionLogs.value[originalLogIndex].status = `All ${toolCallsCount} function calls completed.`
  }
}

// Handle error by updating the original log
function handleError(error, originalLogId, actionLogs, updateCurrentLog) {
  console.error('Open prompt error:', error)
  
  if (originalLogId) {
    const originalLogIndex = actionLogs.value.findIndex(log => log.id === originalLogId)
    if (originalLogIndex !== -1) {
      actionLogs.value[originalLogIndex].status = 'Open prompt failed.'
      actionLogs.value[originalLogIndex].error = error.message
    }
  } else {
    updateCurrentLog({ status: 'Open prompt failed.', error: error.message })
  }
}

// Execute tool calls from open prompt response
export async function executeToolCallsFromPrompt(toolCalls, availableActions, aiInstance, addActionLog, updateCurrentLog, originalLogId, actionLogs) {
  const toolResults = await executeToolCalls(toolCalls, availableActions, aiInstance, addActionLog, updateCurrentLog)
  updateOriginalLog(originalLogId, actionLogs, toolCalls.length)
  
  const result = `Function calls executed:\n${toolResults.join('\n')}`
  console.log('Open prompt result:', result)
  return result
}

// Standalone function to handle open prompt AI calls
export async function handleOpenPrompt(prompt, availableActions, updateCurrentLog, originalLogId, actionLogs) {
  try {
    updateCurrentLog({ status: 'Processing open prompt...' })
    
    const tools = buildToolsArray(availableActions)
    const data = await callOpenAI(prompt, tools)
    const message = data.choices?.[0]?.message
    
    if (message?.tool_calls?.length > 0) {
      console.log('Function calls requested:', message.tool_calls)
      updateCurrentLog({ status: `Executing ${message.tool_calls.length} function call(s)...` })
      
      // Return the tool calls for the application to handle
      return {
        type: 'tool_calls',
        toolCalls: message.tool_calls,
        count: message.tool_calls.length
      }
      
    } else {
      // No tools were run
      const result = message?.content || data.content || JSON.stringify(data)
      console.log('Open prompt result:', result)
      updateCurrentLog({ status: 'No tools were run.', fullResult: truncateText(String(result), 100) })
      
      return {
        type: 'text_response',
        content: result
      }
    }
    
  } catch (error) {
    handleError(error, originalLogId, actionLogs, updateCurrentLog)
    throw error
  }
}


// Actions dictionary (without openPrompt)
export const actionsDictionary = {
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