const stats = [
  { label: 'Knowledge bases', value: '12' },
  { label: 'Documents indexed', value: '86' },
  { label: 'Avg. answer latency', value: '2.4s' },
  { label: 'User feedback', value: '91%' },
];

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-xl">
        <p className="mb-2 text-sm uppercase tracking-[0.2em] text-primary-500">Overview</p>
        <h1 className="text-3xl font-bold text-white">Enterprise knowledge workspace</h1>
        <p className="mt-3 max-w-2xl text-slate-300">
          Upload business documents, keep them searchable, and ask grounded questions with source citations.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-slate-800 bg-slate-900 p-6">
            <p className="text-sm text-slate-400">{stat.label}</p>
            <p className="mt-3 text-3xl font-bold text-white">{stat.value}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="mb-4 text-xl font-semibold text-white">Recent uploads</h2>
          <ul className="space-y-3 text-slate-300">
            <li className="flex items-center justify-between rounded-lg bg-slate-800 px-3 py-2">
              <span>Q4 sales brief.pdf</span>
              <span className="rounded bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300">Completed</span>
            </li>
            <li className="flex items-center justify-between rounded-lg bg-slate-800 px-3 py-2">
              <span>Policy updates.docx</span>
              <span className="rounded bg-yellow-500/10 px-2 py-1 text-xs text-yellow-300">Processing</span>
            </li>
          </ul>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="mb-4 text-xl font-semibold text-white">Prompt patterns</h2>
          <div className="space-y-3 text-slate-300">
            <p className="rounded-lg bg-slate-800 p-3">“Summarize the 2024 vendor risk policy and list evidence references.”</p>
            <p className="rounded-lg bg-slate-800 p-3">“Where is the onboarding SLA documented, and what is the source page?”</p>
          </div>
        </div>
      </section>
    </div>
  );
}
