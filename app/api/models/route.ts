import { NextResponse } from 'next/server';

export async function GET() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
  
  if (!apiKey) {
    return NextResponse.json({ error: 'API Key not configured' }, { status: 500 });
  }

  try {
    // Log sanitized key for debugging
    const sanitizedKey = apiKey ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}` : 'MISSING';
    console.log(`Attempting to fetch models with key: ${sanitizedKey}`);

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models`, {
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      }
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMsg = errorData.error?.message || response.statusText;
      
      // If unauthorized or bad request (invalid key for this endpoint), return fallback immediately without throwing
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        console.warn(`Gemini API Model List failed (${response.status}): ${errorMsg}. Using fallback nodes.`);
        return NextResponse.json({ 
          models: [
            {
              name: 'gemini-3-flash-preview',
              displayName: 'Gemini 3 Flash',
              description: 'Next generation fast and versatile model',
              inputTokenLimit: 1048576,
              outputTokenLimit: 8192,
            },
            {
              name: 'gemini-3.1-pro-preview',
              displayName: 'Gemini 3.1 Pro',
              description: 'Complex reasoning and high creativity',
              inputTokenLimit: 2097152,
              outputTokenLimit: 8192,
            }
          ],
          warning: 'API Key restricted or invalid for model list endpoint. Using fallback models.' 
        });
      }
      throw new Error(`Failed to fetch models: ${errorMsg}`);
    }

    const data = await response.json();
    // Filter for models that support generating content
    const models = data.models
      .filter((m: any) => m.supportedGenerationMethods.includes('generateContent') && !m.name.includes('vision') && !m.name.includes('embedding'))
      .map((m: any) => ({
        name: m.name.replace('models/', ''),
        displayName: m.displayName,
        description: m.description,
        inputTokenLimit: m.inputTokenLimit,
        outputTokenLimit: m.outputTokenLimit,
      }));

    return NextResponse.json({ models });
  } catch (error) {
    console.error('Error fetching models:', error);
    
    // Final fallback if everything fails
    return NextResponse.json({ 
      models: [
        {
          name: 'gemini-3-flash-preview',
          displayName: 'Gemini 3 Flash',
          description: 'Next generation fast and versatile model',
          inputTokenLimit: 1048576,
          outputTokenLimit: 8192,
        },
        {
          name: 'gemini-3.1-pro-preview',
          displayName: 'Gemini 3.1 Pro',
          description: 'Complex reasoning and high creativity',
          inputTokenLimit: 2097152,
          outputTokenLimit: 8192,
        }
      ],
      warning: 'Using internal fallback models list.' 
    });
  }
}
