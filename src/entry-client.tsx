import React from 'react'
import { hydrateRoot } from 'react-dom/client'
import './index.css'
import App from './App'

const data = window.__SSR_DATA__;

hydrateRoot(
    document.getElementById('root')!,
  <React.StrictMode>
    <App data={data}/>
  </React.StrictMode>
)
