import axios from 'axios'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:19999'

export async function getCliConversionFormats(target) {
  const response = await axios.get(`${API_BASE}/api/convert/${encodeURIComponent(target)}/formats`)
  return response.data
}

export async function convertCliRequest(target, params) {
  const response = await axios.post(`${API_BASE}/api/convert/${encodeURIComponent(target)}`, params)
  return response.data
}
