import { useState, useRef, useEffect } from 'react'

interface SearchBarProps {
  onSearch: (query: string) => void
  isSearching: boolean
}

export function SearchBar({ onSearch, isSearching }: SearchBarProps) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleChange = (value: string) => {
    setQuery(value)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => onSearch(value), 250)
  }

  return (
    <div className="relative">
      <svg
        className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Search bookmarks..."
        className="w-full pl-10 pr-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
      />
      {isSearching && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  )
}
