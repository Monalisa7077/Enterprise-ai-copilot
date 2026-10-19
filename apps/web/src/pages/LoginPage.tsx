import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';

const loginSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  return (
    <div className="mx-auto max-w-md rounded-xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
      <h1 className="mb-6 text-2xl font-semibold text-white">Sign in</h1>
      <form
        className="space-y-4"
        onSubmit={handleSubmit((values) => {
          console.log('login', values);
        })}
      >
        <div>
          <label className="mb-1 block text-sm text-slate-300">Email</label>
          <input
            {...register('email')}
            className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none ring-0 placeholder:text-slate-500 focus:border-primary-500"
            placeholder="name@company.com"
          />
          {errors.email && <p className="mt-1 text-sm text-red-400">{errors.email.message}</p>}
        </div>

        <div>
          <label className="mb-1 block text-sm text-slate-300">Password</label>
          <input
            type="password"
            {...register('password')}
            className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none placeholder:text-slate-500 focus:border-primary-500"
            placeholder="••••••••"
          />
          {errors.password && <p className="mt-1 text-sm text-red-400">{errors.password.message}</p>}
        </div>

        <button type="submit" className="w-full rounded bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-500">
          Sign in
        </button>
      </form>
    </div>
  );
}
