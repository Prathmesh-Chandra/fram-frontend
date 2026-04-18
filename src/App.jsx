import { useEffect, useState } from "react"

function App() {
  const [status, setStatus] = useState("checking...")

  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_BASE_URL}/health`)
      .then(r => r.json())
      .then(d => setStatus(d.status))
      .catch(() => setStatus("unreachable"))
  }, [])

  return <div>API status: {status}</div>
}

export default App