# Certificates

`globalsign_gcc_r3_dv_tls_ca_2020.pem` is the public intermediate certificate "GlobalSign GCC R3 DV TLS CA 2020".

- **Why it is here:** the SIL server (`produccion.asamblea.go.cr`) sends only its own certificate and leaves this intermediate out of the chain. Browsers and Windows download it automatically, but Python's `requests` (with certifi) doesn't, so every request fails with "unable to get local issuer certificate". `AsambleaFetcher` verifies HTTPS against certifi plus this file.
- **Source:** the server certificate's "CA Issuers" URL, `http://secure.globalsign.com/cacert/gsgccr3dvtlsca2020.crt` (DER, converted to PEM).
- **Fingerprint (SHA-256):** `76:25:38:43:95:09:C4:11:C4:37:D3:C5:67:56:3E:13:78:67:12:81:FC:4A:14:64:AD:D0:31:87:08:43:67:6E`.
- **Valid until:** March 18, 2029. If the Asamblea renews or changes its certificate and requests fail again, download the new intermediate from the URL shown by `openssl s_client -connect produccion.asamblea.go.cr:443 | openssl x509 -noout -ext authorityInfoAccess`.
