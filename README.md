# WhatsApp AI Agent Dashboard

A full-stack Next.js application that provides a WhatsApp AI agent with a real-time business dashboard.

## Features

- 🤖 AI-powered WhatsApp responses using OpenAI GPT-4
- 📊 Real-time dashboard to monitor all conversations
- 🔐 Secure authentication with Supabase
- 💾 Automatic message storage in Supabase database
- 🎨 Modern dark theme UI

## Tech Stack

- **Frontend**: Next.js 14, React, TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes
- **Database**: Supabase (PostgreSQL)
- **AI**: OpenAI GPT-4
- **WhatsApp**: Meta WhatsApp Cloud API
- **Hosting**: Vercel

## Setup Instructions

### 1. Clone and Install Dependencies

```bash
cd whatsapp-agent
npm install
```

### 2. Configure Environment Variables

Copy `.env.local.example` to `.env.local` and fill in your credentials:

```bash
cp .env.local.example .env.local
```

Required variables:
- `WHATSAPP_ACCESS_TOKEN` - From Meta Business Suite
- `WHATSAPP_PHONE_NUMBER_ID` - From Meta Business Suite
- `WHATSAPP_VERIFY_TOKEN` - Any string you choose for webhook verification
- `OPENAI_API_KEY` - From OpenAI platform
- `NEXT_PUBLIC_SUPABASE_URL` - From Supabase project settings
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - From Supabase project settings
- `SUPABASE_SERVICE_ROLE_KEY` - From Supabase project settings

### 3. Setup Supabase Database

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to SQL Editor
3. Copy the contents of `supabase/schema.sql`
4. Paste and run the SQL

This will create:
- `conversations` table
- `messages` table
- Required indexes and RLS policies
- Realtime subscriptions

### 4. Create Supabase User for Login

1. In Supabase, go to Authentication > Users
2. Click "Add new user"
3. Create a user with email and password
4. Use these credentials to log into the dashboard

### 5. Deploy to Vercel

1. Create a GitHub repository and push your code
2. Go to [vercel.com](https://vercel.com) and create a new project
3. Import your GitHub repository
4. Add all environment variables from step 2
5. Deploy

### 6. Configure WhatsApp Webhook

After deploying to Vercel:

1. Go to your Meta Business Suite > WhatsApp > API Setup
2. In the Webhook section, paste your Vercel URL:
   ```
   https://your-app.vercel.app/api/webhook
   ```
3. Enter your `WHATSAPP_VERIFY_TOKEN`
4. Click "Verify and Save"
5. Subscribe to "messages" webhook field

### 7. Test Your Agent

Send a message to your WhatsApp number and:
- You should receive an AI response
- The conversation should appear in your dashboard

## Customizing the AI Agent

Edit `AGENT_PROMPT.md` to change the agent's behavior, tone, and knowledge base.

## Project Structure

```
whatsapp-agent/
├── app/
│   ├── api/webhook/     # WhatsApp webhook endpoint
│   ├── dashboard/       # Dashboard pages
│   ├── layout.tsx       # Root layout
│   ├── page.tsx         # Login page
│   └── globals.css      # Global styles
├── components/
│   ├── ChatView.tsx     # Message display component
│   ├── ConversationSidebar.tsx  # Conversations list
│   └── LoginForm.tsx    # Login form
├── lib/
│   ├── supabase.ts      # Server-side Supabase client
│   └── supabaseClient.ts # Client-side Supabase client
├── supabase/
│   └── schema.sql       # Database schema
├── AGENT_PROMPT.md      # AI system prompt
└── .env.local.example   # Environment variables template
```

## Security Notes

- Never commit `.env.local` to version control
- Use `SUPABASE_SERVICE_ROLE_KEY` only in server-side code
- The webhook uses the service role to bypass RLS for writing messages
- Frontend uses the anon key with RLS policies for reading

## Troubleshooting

### Webhook verification fails
- Make sure `WHATSAPP_VERIFY_TOKEN` matches exactly in both places
- Check that your Vercel app is deployed and accessible

### No messages appearing in dashboard
- Check Vercel logs for errors
- Verify Supabase credentials are correct
- Ensure realtime is enabled on both tables

### WhatsApp not sending responses
- Verify `WHATSAPP_ACCESS_TOKEN` is valid (not expired)
- Check that `WHATSAPP_PHONE_NUMBER_ID` is correct
- Ensure the webhook is subscribed to "messages" events

## License

MIT
