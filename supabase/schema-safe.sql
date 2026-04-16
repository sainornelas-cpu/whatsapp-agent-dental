-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Conversations table
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_number TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable realtime (safe version - only adds if not already there)
DO $$
BEGIN
    -- Add conversations to realtime if not already there
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversations'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
        RAISE NOTICE 'Added conversations to supabase_realtime';
    ELSE
        RAISE NOTICE 'conversations already in supabase_realtime';
    END IF;

    -- Add messages to realtime if not already there
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE messages;
        RAISE NOTICE 'Added messages to supabase_realtime';
    ELSE
        RAISE NOTICE 'messages already in supabase_realtime';
    END IF;
END $$;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversations_phone_number ON conversations(phone_number);

-- Enable RLS (safe - already enabled is OK)
ALTER TABLE IF EXISTS conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS messages ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid duplicate errors)
DROP POLICY IF EXISTS "Service role all access conversations" ON conversations;
DROP POLICY IF EXISTS "Service role all access messages" ON messages;
DROP POLICY IF EXISTS "Authenticated users can read conversations" ON conversations;
DROP POLICY IF EXISTS "Authenticated users can read messages" ON messages;

-- Service role can do everything
CREATE POLICY "Service role all access conversations" ON conversations
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role all access messages" ON messages
    FOR ALL USING (auth.role() = 'service_role');

-- Authenticated users can read everything
CREATE POLICY "Authenticated users can read conversations" ON conversations
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can read messages" ON messages
    FOR SELECT USING (auth.role() = 'authenticated');

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists, then create
DROP TRIGGER IF EXISTS update_conversations_updated_at ON conversations;
CREATE TRIGGER update_conversations_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to get or create conversation by phone number
CREATE OR REPLACE FUNCTION get_or_create_conversation(phone_num TEXT)
RETURNS UUID AS $$
DECLARE
    conv_id UUID;
BEGIN
    SELECT id INTO conv_id FROM conversations WHERE phone_number = phone_num;

    IF conv_id IS NULL THEN
        INSERT INTO conversations (phone_number) VALUES (phone_num)
        RETURNING id INTO conv_id;
    END IF;

    RETURN conv_id;
END;
$$ LANGUAGE plpgsql;

-- Verification query to check everything is set up
DO $$
DECLARE
    conversations_count INTEGER;
    messages_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO conversations_count FROM conversations;
    SELECT COUNT(*) INTO messages_count FROM messages;

    RAISE NOTICE '=== SETUP COMPLETE ===';
    RAISE NOTICE 'Conversations table: % rows', conversations_count;
    RAISE NOTICE 'Messages table: % rows', messages_count;
    RAISE NOTICE 'Function get_or_create_conversation: READY';
    RAISE NOTICE 'RLS policies: READY';
    RAISE NOTICE 'Realtime: ENABLED';
END $$;
