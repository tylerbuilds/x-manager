import { generateTweetsFromContext } from '@/lib/azureopenai';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const SYSTEM_PROMPT = `You are an expert tweet writer.
Based on the provided transcription of a conversation, generate a list of 5-10 potential tweets.
The tweets should be engaging, concise, and relevant to the key topics in the conversation.
Each tweet must be 280 characters or less.
Return the tweets as a JSON array of strings. For example: ["This is a tweet.", "This is another tweet."].
Do not include any other text or explanation in your response, only the JSON array.`;

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get('content-type');
    
    if (contentType?.includes('application/json')) {
      // Handle new format from AddContext component
      const body = await req.json();
      const { content, contextType, systemPrompt } = body;

      if (!content) {
        return NextResponse.json({ error: 'No content provided.' }, { status: 400 });
      }

      const finalSystemPrompt = systemPrompt || SYSTEM_PROMPT;
      
      // Adjust the system prompt based on context type
      let adaptedPrompt = finalSystemPrompt;
      if (contextType === 'document') {
        adaptedPrompt = adaptedPrompt.replace(
          'Based on the provided transcription of a conversation',
          'Based on the provided document'
        );
      }

      const tweets = await generateTweetsFromContext(content, adaptedPrompt, contextType);
      return NextResponse.json({ tweets });
    } else {
      // Handle legacy format from old TweetGenerator component
      const formData = await req.formData();
      const file = formData.get('file') as File;

      if (!file) {
        return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });
      }

      if (file.type !== 'text/plain') {
        return NextResponse.json({ error: 'Only .txt files are allowed.' }, { status: 400 });
      }

      const transcription = await file.text();
      const tweets = await generateTweetsFromContext(transcription, SYSTEM_PROMPT, 'transcription');
      return NextResponse.json({ tweets });
    }
  } catch (error) {
    console.error('Error generating tweets:', error);
    return NextResponse.json({ error: 'Failed to generate tweets.' }, { status: 500 });
  }
} 