// ==================== CONFIG =====================
const YOUR_API_KEYS = ["SPLEXXO"]; // tumhara private key
const HALFBLOOD_URL = "https://halfblood.famapp.in/vpa/verifyExt";
const RAZORPAY_IFSC_URL = "https://ifsc.razorpay.com/";
const CACHE_TIME = 3600 * 1000; // 1 hour (ms)
// =================================================

const cache = new Map();
const HEADERS = {
    'User-Agent': "A015 | Android 15 | Dalvik/2.1.0 | Tetris | 318D0D6589676E17F88CCE03A86C2591C8EBAFBA | (Build -1) | 3DB5HIEMMG",
    'Accept': "application/json",
    'Content-Type': "application/json",
    'authorization': "Token eyJlbmMiOiJBMjU2Q0JDLUhTNTEyIiwiZXBrIjp7Imt0eSI6Ik9LUCIsImNydiI6Ilg0NDgiLCJ4IjoiZldEV2hlWTRyUXZRdzJQT0NCWWJpcFN6ZmJaczFPZFktWGcwZ25ORFV4VDVVNnV3TjhCLUw0Rm9PU1JQMGhKWVoyX1FiTnJqQ0s0In0sImFsZyI6IkVDREgtRVMifQ..YomDRfMtMXcQvvY5zqo1Rw.hgxy4MfXnzkqq8Xc31sYov9ggEovQJ7CebQnmeQ1RnyJBy52kHi_1kcEwX82oYZIuQaZ8FFSqIqCoIxrVJrqQflHF_ZjaU4lhwcoAV-l2_9vMjMe31FpZ9iXe56SxIGi3wEIDDyMnzWYW8N41An_srXEXj-y5nI-p1k4NEh_Ld0QwtLW4oR0NWJjySEhaeJy09H3EEZ9paJmlJPK2fKpaQ0k7eBKq6Ltib_l7kMmSJ5V7qnl5FX20mz-0IjkSa3BIOvfrkQg_TrzjzGg3l3B7g.QdQj098-_lKf08lxXEL3raDrj6gHHEYQjMAJ_7W1mPo"
};

// Helper: recursively clean @oxmzoo from JSON
function cleanOxmzoo(value) {
    if (typeof value === "string") {
        return value.replace(/@oxmzoo/gi, "").trim();
    }
    if (Array.isArray(value)) {
        return value.map(cleanOxmzoo);
    }
    if (value && typeof value === "object") {
        const cleaned = {};
        for (const key of Object.keys(value)) {
            if (key === "@oxmzoo") continue; // key hi remove
            cleaned[key] = cleanOxmzoo(value[key]);
        }
        return cleaned;
    }
    return value;
}

async function fetchUPIDetails(upi_id) {
    const vpa_payload = {"upi_string": `upi://pay?pa=${upi_id}`};
    try {
        // Step 1: FamPay API se VPA details
        const response_vpa = await fetch(HALFBLOOD_URL, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify(vpa_payload),
            timeout: 10000
        });

        if (!response_vpa.ok) {
            // New Logic: Read the response body for full error details
            let errorDetails = `FamPay API failed with status ${response_vpa.status}`;
            try {
                // Attempt to read JSON body
                const errorBody = await response_vpa.json();
                // Return a structured error with the response body
                return {
                    "error": "FamPay API failed",
                    "status": response_vpa.status,
                    "response_body": errorBody 
                };
            } catch (e) {
                // If JSON fails, read as text (or just return the status error)
                errorDetails += `. Could not parse error body as JSON.`;
            }
            // Fallback for non-JSON errors
            throw new Error(errorDetails);
        }

        const vpa_data = await response_vpa.json();
        const vpa_info = vpa_data?.data?.verify_vpa_resp || {};

        if (!vpa_info || Object.keys(vpa_info).length === 0) {
            return {"error": "VPA not found"};
        }

        const vpa_details = {
            "name": vpa_info.name || "",
            "vpa": vpa_info.vpa || upi_id,
            "ifsc": vpa_info.ifsc || ""
        };

        // Step 2: Razorpay IFSC API se bank details
        let bank_details = null;
        const ifsc_code = vpa_details.ifsc;
        if (ifsc_code) {
            try {
                const response_ifsc = await fetch(`${RAZORPAY_IFSC_URL}${ifsc_code}`, {
                    timeout: 10000
                });
                if (response_ifsc.ok) {
                    bank_details = await response_ifsc.json();
                } else {
                    bank_details = {"warning": "Bank details not found"};
                }
            } catch (ifsc_error) {
                bank_details = {"warning": "Bank details fetch failed"};
            }
        }

        return {
            "vpa_details": vpa_details,
            "bank_details": bank_details,
            "status": "success"
        };
    } catch (error) {
        // This catch block will only execute if the network call failed (not a non-200 HTTP status)
        // or if the `throw new Error(errorDetails)` fallback was hit.
        return {"error": `API call failed: ${error.message}`};
    }
}

module.exports = async (req, res) => {
    // Sirf GET allow
    if (req.method !== "GET") {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.status(405).json({ error: "method not allowed" });
    }

    const { upi: rawUpi, key: rawKey } = req.query || {};

    // Param check
    if (!rawUpi || !rawKey) {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.status(400).json({ error: "missing parameters: upi or key", usage: "?upi=username@paytm&key=SPLEXXO" });
    }

    // UPI ID sanitize
    const upi_id = String(rawUpi).trim().toLowerCase();
    const key = String(rawKey).trim();

    // API key check
    if (!YOUR_API_KEYS.includes(key)) {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.status(403).json({ error: "invalid key" });
    }

    // Cache check
    const now = Date.now();
    const cached = cache.get(upi_id);
    if (cached && now - cached.timestamp < CACHE_TIME) {
        res.setHeader("X-Proxy-Cache", "HIT");
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.status(200).send(cached.response);
    }

    try {
        // UPI details fetch karo
        let upi_data = await fetchUPIDetails(upi_id);

        // Agar error hai to directly return (This handles both your custom error and the new FamPay API failure with body)
        if (upi_data.error) {
            // If the error includes response_body, use a more appropriate status like the one returned by FamPay, 
            // but for simplicity, I'll keep 404/502/400 logic depending on the type of error. 
            
            // If it's a specific FamPay failure with a body, let's return it with 502 Bad Gateway or 400/404 based on context.
            // Since the user requested the full error, we return the object as-is.
            if (upi_data.response_body) {
                // Use the status from the API if available, otherwise 502
                const httpStatus = upi_data.status || 502; 
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                // Remove the 'error' field which is now redundant with the body
                delete upi_data.error; 
                return res.status(httpStatus).json(upi_data);
            }
            
            // For other simple errors (VPA not found, network issues)
            const httpStatus = upi_data.error.includes("VPA not found") ? 404 : 502;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            return res.status(httpStatus).json(upi_data);
        }

        // Saare data se @oxmzoo clean karo
        upi_data = cleanOxmzoo(upi_data);

        // Apni branding add karo
        upi_data.credit_by = "splexx";
        upi_data.developer = "splexxo";
        upi_data.powered_by = "splexxo UPI Info API";

        const responseBody = JSON.stringify(upi_data);

        // Cache save
        cache.set(upi_id, { timestamp: Date.now(), response: responseBody });

        res.setHeader("X-Proxy-Cache", "MISS");
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.status(200).send(responseBody);
    } catch (err) {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.status(502).json({ error: "upstream request error", details: err.message || "unknown error" });
    }
};
