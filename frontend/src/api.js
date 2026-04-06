import axios from "axios";

const BASE = "http://localhost:5000";
const API = `${BASE}/portfolio`;

/**
 * 📊 GET
 */
export const getPortfolio = () => axios.get(API);

/**
 * ➕ UPSERT (single add/update)
 */
export const addHolding = (data) => {
  console.log("API CALL:", data); // debug
  return axios.post(API, data);
};

/**
 * 🔁 REPLACE (bulk upload)
 */
export const replacePortfolio = (data) =>
  axios.post(`${BASE}/portfolio/replace`, {
    holdings: data,
  });

/**
 * ❌ DELETE
 */
export const deleteHolding = (id) =>
  axios.delete(`${API}/${id}`);

/**
 * ✏️ UPDATE (manual edit)
 */
export const updateHolding = (id, data) =>
  axios.put(`${API}/${id}`, data);

export const updatePrices = () =>
  axios.get("http://localhost:5000/prices/update");