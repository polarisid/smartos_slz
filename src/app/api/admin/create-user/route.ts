import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

// This route uses the SERVICE_ROLE_KEY to create users without affecting
// the current admin session. This key must NEVER be exposed on the client.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

export async function POST(req: NextRequest) {
  try {
    // Validate the service role key is set
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: 'Server misconfiguration: SUPABASE_SERVICE_ROLE_KEY not set.' },
        { status: 500 }
      );
    }

    const { email, password, name, role } = await req.json();

    if (!email || !password || !name || !role) {
      return NextResponse.json({ error: 'Todos os campos são obrigatórios.' }, { status: 400 });
    }

    const validRoles = ['admin', 'technician', 'counter_technician'];
    if (!validRoles.includes(role)) {
      return NextResponse.json({ error: 'Função inválida.' }, { status: 400 });
    }

    // 1. Create auth user using admin API (no email confirmation, no session change)
    const { data: newUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Skip email confirmation
      user_metadata: { name },
    });

    if (authError) {
      // Map common Supabase admin errors to friendly messages
      if (authError.message.includes('already been registered')) {
        return NextResponse.json({ error: 'Este email já está em uso.' }, { status: 409 });
      }
      if (authError.message.includes('invalid')) {
        return NextResponse.json({ error: 'Email ou senha inválidos.' }, { status: 400 });
      }
      return NextResponse.json({ error: authError.message }, { status: 400 });
    }

    if (!newUser.user) {
      return NextResponse.json({ error: 'Falha ao criar usuário.' }, { status: 500 });
    }

    // 2. Create the profile record in the profiles table
    const { error: profileError } = await supabaseAdmin.from('profiles').insert({
      id: newUser.user.id,
      name,
      email: newUser.user.email,
      role,
    });

    if (profileError) {
      // If profile creation fails, clean up the auth user to avoid orphaned accounts
      await supabaseAdmin.auth.admin.deleteUser(newUser.user.id);
      console.error('Profile creation failed:', profileError);
      return NextResponse.json({ error: 'Falha ao criar perfil do usuário.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, userId: newUser.user.id }, { status: 201 });
  } catch (error: any) {
    console.error('Create user API error:', error);
    return NextResponse.json({ error: 'Erro interno do servidor.' }, { status: 500 });
  }
}
