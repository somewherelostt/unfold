import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/auth/server";

/** POST /auth/signout (use a <form method="post">). GET is not supported so links can't sign people out. */
export async function POST(request: NextRequest) {
  const db = await createClient();
  if (db) await db.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.nextUrl.origin), { status: 303 });
}
