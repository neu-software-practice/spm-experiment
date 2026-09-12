import { Button } from '@/components/ui/button'

function App() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 px-6">
      <section className="w-full max-w-lg rounded-xl border bg-card p-8 text-card-foreground shadow-sm">
        <p className="mb-2 text-sm font-medium text-muted-foreground">
          spm-experiment
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Project initialized
        </h1>
        <p className="mt-3 text-muted-foreground">
          Vite, React, Tailwind CSS, and shadcn are ready.
        </p>
        <Button
          className="mt-6"
          onClick={() => {
            window.location.href = 'http://localhost:8080/api/health'
          }}
        >
          Check backend
        </Button>
      </section>
    </main>
  )
}

export default App
