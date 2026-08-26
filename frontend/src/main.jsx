import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Apply the saved theme before first paint to avoid a flash.
// Support old and new localStorage keys during migration
const savedTheme = localStorage.getItem('grafted_theme')
  || localStorage.getItem('devradar_theme')
  || 'rosepine-dawn'
document.documentElement.setAttribute('data-theme', savedTheme)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
