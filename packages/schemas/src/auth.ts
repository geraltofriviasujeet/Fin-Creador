import { z } from "zod";

export const PASSWORD_MIN_LENGTH = 8;
// bcrypt (used by Supabase Auth) ignores bytes beyond 72.
export const PASSWORD_MAX_LENGTH = 72;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Enter your email")
  .pipe(z.email("Enter a valid email address"));

export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`);

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password"),
});

export const signUpSchema = z.object({
  displayName: z.string().trim().min(1, "Enter your name").max(80, "Keep your name under 80 characters"),
  email: emailSchema,
  password: newPasswordSchema,
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const updatePasswordSchema = z
  .object({
    password: newPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });
