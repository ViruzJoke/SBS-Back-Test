// /api/ship.js
// Vercel Serverless Function for creating a DHL Shipment
// v14 - Added Shipper/Receiver Email logging

import fetch from 'node-fetch';
import { sql } from '@vercel/postgres';

const ALLOWED_ORIGINS = [
    'https://viruzjoke.github.io',
    'thcfit.duckdns.org',
    'thcfit-admin.duckdns.org',
    'https://thcfit.vercel.app',
    'https://thcfit-admin.vercel.app'
];

export default async function handler(req, res) {

    // ================= START: Code Debugging =================
    console.log("--- VERCEL ENVIRONMENT DEBUG ---");
    console.log("Timestamp:", new Date().toISOString());
    console.log("DHL_USERNAME (from env):", process.env.DHL_USERNAME);
    console.log("DHL_PASSWORD (from env):", process.env.DHL_PASSWORD ? "Exists (hidden for security)" : "MISSING!");
	console.log("DHL_USERNAME_Production (from env):", process.env.DHL_USERNAME_Production);
    console.log("DHL_PASSWORD_Production (from env):", process.env.DHL_PASSWORD_Production ? "Exists (hidden for security)" : "MISSING!");
    console.log("DHL_API_ENDPOINT_SHIP (from env):", process.env.DHL_API_ENDPOINT_SHIP);
    console.log("--- END DEBUG ---");
    // ================== END: Code Debugging ==================
    
    // Set CORS headers
    const origin = req.headers.origin;
    if (ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

    const username = process.env.DHL_USERNAME;
    const password = process.env.DHL_PASSWORD;
    const shipEndpoint = process.env.DHL_API_ENDPOINT_SHIP;
    
    const dhlApiRequestPayload = req.body;

    console.log('--- Incoming Request Payload ---');
    console.log(JSON.stringify(dhlApiRequestPayload, null, 2));

    // Extract request data early for logging purposes
    const shipper = dhlApiRequestPayload?.customerDetails?.shipperDetails;
    const receiver = dhlApiRequestPayload?.customerDetails?.receiverDetails;
    const accounts = dhlApiRequestPayload?.accounts || [];
    
    const shipperName = shipper?.contactInformation?.fullName || null;
    const shipperCompany = shipper?.contactInformation?.companyName || null;
    const shipperPhone = shipper?.contactInformation?.phone || null;
    const shipperEmail = shipper?.contactInformation?.email || null; 
    const shipperCountry = shipper?.postalAddress?.countryCode || null;
    
    const receiverName = receiver?.contactInformation?.fullName || null;
    const receiverCompany = receiver?.contactInformation?.companyName || null;
    const receiverPhone = receiver?.contactInformation?.phone || null;
    const receiverEmail = receiver?.contactInformation?.email || null;
    const receiverCountry = receiver?.postalAddress?.countryCode || null;

    const requestReference = dhlApiRequestPayload?.customerReferences?.[0]?.value || null;
    
    const shipperAccountNumber = accounts.find(acc => acc.typeCode === 'shipper')?.number || null;
    const billingAccountNumber = accounts.find(acc => acc.typeCode === 'payer')?.number || null;
    const dutyAccountNumber = accounts.find(acc => acc.typeCode === 'duties-taxes')?.number || null;

    try {
        if (!username || !password || !shipEndpoint) {
            throw new Error('API environment variables for shipment are not configured correctly on the server.');
        }

        const auth = 'Basic ' + Buffer.from(username + ':' + password).toString('base64');
        
        const shipmentResponse = await fetch(shipEndpoint, {
            method: 'POST',
            headers: { 
                'Authorization': auth, 
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify(dhlApiRequestPayload)
        });

        const responseBodyText = await shipmentResponse.text();
        let shipmentData;
        
        try {
             shipmentData = JSON.parse(responseBodyText);
                    } catch(e) {
                        console.error('DHL Shipment API Non-JSON Response:', responseBodyText);
                        try {
                            const errorMessage = 'Failed to parse JSON response from DHL: ' + responseBodyText;
                            await sql`
                                INSERT INTO shipment_test_logs (
                                    created_at, log_type, respond_warnings,
                                    shipper_name, shipper_company, shipper_phone, shipper_email, shipper_country,
                                    receiver_name, receiver_company, receiver_phone, receiver_email, receiver_country,
                                    request_reference, shipper_account_number, billing_account_number, duty_account_number, booking_ref
                                ) VALUES (
                                    NOW() AT TIME ZONE 'Asia/Bangkok', 'Error', ${errorMessage},
                                    ${shipperName}, ${shipperCompany}, ${shipperPhone}, ${shipperEmail}, ${shipperCountry},
                                    ${receiverName}, ${receiverCompany}, ${receiverPhone}, ${receiverEmail}, ${receiverCountry},
                                    ${requestReference}, ${shipperAccountNumber}, ${billingAccountNumber}, ${dutyAccountNumber}, null
                                );
                            `;            } catch (dbError) {
                console.error("Database logging failed for Non-JSON response:", dbError);
            }
            return res.status(shipmentResponse.status || 500).json({ 
                title: 'API Error', 
                detail: 'Received an invalid response from the DHL server.',
                response: responseBodyText
            });
        }

        console.log('--- DHL API Response Body ---');
        console.log(JSON.stringify(shipmentData, null, 2));

        if (!shipmentResponse.ok) {
            console.error('DHL Shipment API Error:', responseBodyText);
            
            let errorMessage = shipmentData.detail || shipmentData.message || JSON.stringify(shipmentData);

            if (Array.isArray(shipmentData.additionalDetails) && shipmentData.additionalDetails.length > 0) {
                const additionalDetailsString = shipmentData.additionalDetails.map(detail => detail.message || detail).join('; ');
                errorMessage = `${errorMessage}; Additional Details: ${additionalDetailsString}`;
            }

            try {
                await sql`
                    INSERT INTO shipment_test_logs (
                        created_at, log_type, respond_warnings,
                        shipper_name, shipper_company, shipper_phone, shipper_email, shipper_country,
                        receiver_name, receiver_company, receiver_phone, receiver_email, receiver_country,
                        request_reference, shipper_account_number, billing_account_number, duty_account_number, booking_ref
                    ) VALUES (
                        NOW() AT TIME ZONE 'Asia/Bangkok', 'Error', ${errorMessage},
                        ${shipperName}, ${shipperCompany}, ${shipperPhone}, ${shipperEmail}, ${shipperCountry},
                        ${receiverName}, ${receiverCompany}, ${receiverPhone}, ${receiverEmail}, ${receiverCountry},
                        ${requestReference}, ${shipperAccountNumber}, ${billingAccountNumber}, ${dutyAccountNumber}, null
                    );
                `;
            } catch (dbError) {
                console.error("Database logging failed for DHL API error:", dbError);
            }
            return res.status(shipmentResponse.status).json(shipmentData);
        }
        
        // On success, process and log the data
        try {
            const trackingNumber = shipmentData?.shipmentTrackingNumber || null;
            const bookingRef = shipmentData?.dispatchConfirmationNumber || null;
            const packageIds = shipmentData?.packages?.map(p => p.trackingNumber).join(',') || null;
            const warnings = shipmentData?.warnings?.join('; ') || null;
            const findDocContent = (type) => shipmentData?.documents?.find(d => d.typeCode.toLowerCase() === type)?.content || null;
            const labelContent = findDocContent('label') || findDocContent('waybilldoc');
            const receiptContent = findDocContent('receipt') || findDocContent('shipmentreceipt');
            const invoiceContent = findDocContent('invoice');

            await sql`
                INSERT INTO shipment_test_logs (
                    created_at,
                    log_type, 
                    respond_trackingnumber, 
                    booking_ref,
                    respond_packagesid, 
                    respond_label, 
                    respond_receipt, 
                    respond_invoice, 
                    respond_warnings,
                    shipper_name,
                    shipper_company,
                    shipper_phone,
                    shipper_email,
                    shipper_country,
                    receiver_name,
                    receiver_company,
                    receiver_phone,
                    receiver_email,
                    receiver_country,
                    request_reference,
                    shipper_account_number,
                    billing_account_number,
                    duty_account_number
                )
                VALUES (
                    NOW() AT TIME ZONE 'Asia/Bangkok',
                    'Success', 
                    ${trackingNumber}, 
                    ${bookingRef},
                    ${packageIds}, 
                    ${labelContent}, 
                    ${receiptContent}, 
                    ${invoiceContent}, 
                    ${warnings},
                    ${shipperName},
                    ${shipperCompany},
                    ${shipperPhone},
                    ${shipperEmail},
                    ${shipperCountry},
                    ${receiverName},
                    ${receiverCompany},
                    ${receiverPhone},
                    ${receiverEmail},
                    ${receiverCountry},
                    ${requestReference},
                    ${shipperAccountNumber},
                    ${billingAccountNumber},
                    ${dutyAccountNumber}
                );
            `;
        } catch (dbError) {
            console.error("Database logging failed for successful shipment:", dbError);
        }

        console.log('--- Final Response to Client ---');
        console.log(JSON.stringify(shipmentData, null, 2));

        res.status(200).json(shipmentData);

    } catch (error) {
        try {
            await sql`
                INSERT INTO shipment_test_logs (
                    created_at, log_type, respond_warnings,
                    shipper_name, shipper_company, shipper_phone, shipper_email, shipper_country,
                    receiver_name, receiver_company, receiver_phone, receiver_email, receiver_country,
                    request_reference, shipper_account_number, billing_account_number, duty_account_number, booking_ref
                ) VALUES (
                    NOW() AT TIME ZONE 'Asia/Bangkok', 'Error', ${error.message},
                    ${shipperName}, ${shipperCompany}, ${shipperPhone}, ${shipperEmail}, ${shipperCountry},
                    ${receiverName}, ${receiverCompany}, ${receiverPhone}, ${receiverEmail}, ${receiverCountry},
                    ${requestReference}, ${shipperAccountNumber}, ${billingAccountNumber}, ${dutyAccountNumber}, null
                );
            `;
        } catch (dbError) {
            console.error("Database logging failed for internal server error:", dbError);
        }
        console.error('Error processing shipment request:', error);
        return res.status(500).json({ 
            title: 'Internal Server Error', 
            detail: 'An unexpected error occurred on the server.',
            errorMessage: error.message 
        });
    }
}




