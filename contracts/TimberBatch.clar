(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-LAT u101)
(define-constant ERR-INVALID-LON u102)
(define-constant ERR-INVALID-VOLUME u103)
(define-constant ERR-INVALID-SPECIES u104)
(define-constant ERR-INVALID-TIMESTAMP-HASH u105)
(define-constant ERR-BATCH-ALREADY-EXISTS u106)
(define-constant ERR-BATCH-NOT-FOUND u107)
(define-constant ERR-INVALID-BURNER u108)
(define-constant ERR-MAX-BATCHES-EXCEEDED u109)
(define-constant ERR-INVALID-MINT-FEE u110)
(define-constant ERR-ORACLE-NOT-VERIFIED u111)
(define-constant ERR-INVALID-GPS u112)
(define-constant ERR-INVALID-TIMESTAMP u113)

(define-data-var next-batch-id uint u0)
(define-data-var max-batches uint u5000)
(define-data-var mint-fee uint u500)
(define-data-var authority-contract (optional principal) none)
(define-data-var oracle-contract (optional principal) none)

(define-map batches
  uint
  {
    lat: int,
    lon: int,
    species: (string-utf8 50),
    volume: uint,
    timestamp-hash: (buff 32),
    mint-timestamp: uint,
    owner: principal,
    status: bool,
    gps-verified: bool,
    oracle-verified: bool
  }
)

(define-map batch-owners uint principal)
(define-map owner-batch-count principal uint)

(define-private (validate-lat (lat int))
  (if (and (>= lat -90) (<= lat 90))
      (ok true)
      (err ERR-INVALID-LAT))
)

(define-private (validate-lon (lon int))
  (if (and (>= lon -180) (<= lon 180))
      (ok true)
      (err ERR-INVALID-LON))
)

(define-private (validate-gps (lat int) (lon int))
  (begin
    (try! (validate-lat lat))
    (try! (validate-lon lon))
    (ok {lat: lat, lon: lon})
  )
)

(define-private (validate-volume (volume uint))
  (if (> volume u0)
      (ok true)
      (err ERR-INVALID-VOLUME))
)

(define-private (validate-species (species (string-utf8 50)))
  (let ((len (len species)))
    (if (and (> len u0) (<= len u50)
             (or (is-eq species "Oak") (is-eq species "Pine") (is-eq species "Maple")
                 (is-eq species "Birch") (is-eq species "Cedar") (is-eq species "Fir")))
        (ok true)
        (err ERR-INVALID-SPECIES))
  )
)

(define-private (validate-timestamp-hash (hash (buff 32)))
  (if (is-eq (len hash) u32)
      (ok true)
      (err ERR-INVALID-TIMESTAMP-HASH))
)

(define-private (validate-mint-timestamp (ts uint))
  (if (>= ts block-height)
      (ok true)
      (err ERR-INVALID-TIMESTAMP))
)

(define-private (is-authorized-logger (caller principal))
  (let ((auth (var-get authority-contract)))
    (match auth
      authority (contract-call? authority is-logger caller)
      (err ERR-ORACLE-NOT-VERIFIED)
    )
  )
)

(define-private (is-authorized-burner (caller principal) (batch-owner principal))
  (or (is-eq caller batch-owner)
      (let ((auth (var-get authority-contract)))
        (match auth
          authority (contract-call? authority is-regulator caller)
          false
        )
      )
  )
)

(define-private (pay-mint-fee)
  (let ((fee (var-get mint-fee))
        (auth (unwrap! (var-get authority-contract) (err ERR-ORACLE-NOT-VERIFIED))))
    (try! (stx-transfer? fee tx-sender auth))
    (ok true)
  )
)

(define-public (set-authority-contract (contract-principal principal))
  (begin
    (asserts! (is-none (var-get authority-contract)) (err ERR-ORACLE-NOT-VERIFIED))
    (var-set authority-contract (some contract-principal))
    (ok true)
  )
)

(define-public (set-oracle-contract (contract-principal principal))
  (begin
    (asserts! (is-some (var-get authority-contract)) (err ERR-ORACLE-NOT-VERIFIED))
    (var-set oracle-contract (some contract-principal))
    (ok true)
  )
)

(define-public (set-max-batches (new-max uint))
  (begin
    (asserts! (is-some (var-get authority-contract)) (err ERR-ORACLE-NOT-VERIFIED))
    (asserts! (> new-max u0) (err ERR-INVALID-MINT-FEE))
    (var-set max-batches new-max)
    (ok true)
  )
)

(define-public (set-mint-fee (new-fee uint))
  (begin
    (asserts! (is-some (var-get authority-contract)) (err ERR-ORACLE-NOT-VERIFIED))
    (asserts! (>= new-fee u0) (err ERR-INVALID-MINT-FEE))
    (var-set mint-fee new-fee)
    (ok true)
  )
)

(define-read-only (get-batch (id uint))
  (map-get? batches id)
)

(define-read-only (get-batch-owner (id uint))
  (map-get? batch-owners id)
)

(define-read-only (get-owner-batch-count (owner principal))
  (default-to u0 (map-get? owner-batch-count owner))
)

(define-read-only (is-batch-minted (id uint))
  (is-some (map-get? batches id))
)

(define-public (mint-batch
  (batch-id uint)
  (lat int)
  (lon int)
  (species (string-utf8 50))
  (volume uint)
  (timestamp-hash (buff 32))
  (mint-ts uint)
)
  (let (
        (next-id (var-get next-batch-id))
        (current-max (var-get max-batches))
      )
    (asserts! (is-eq batch-id next-id) (err ERR-BATCH-ALREADY-EXISTS))
    (asserts! (< next-id current-max) (err ERR-MAX-BATCHES-EXCEEDED))
    (try! (is-authorized-logger tx-sender))
    (try! (validate-gps lat lon))
    (try! (validate-species species))
    (try! (validate-volume volume))
    (try! (validate-timestamp-hash timestamp-hash))
    (try! (validate-mint-timestamp mint-ts))
    (try! (pay-mint-fee))
    (let (
          (verified-gps (unwrap! (validate-gps lat lon) (err ERR-INVALID-GPS)))
          (oracle (var-get oracle-contract))
        )
      (match oracle
        oracle-contract
          (let (
                (oracle-res (contract-call? oracle-contract verify-timestamp timestamp-hash mint-ts))
              )
            (match oracle-res
              verified
                (begin
                  (map-set batches next-id
                    {
                      lat: (get lat verified-gps),
                      lon: (get lon verified-gps),
                      species: species,
                      volume: volume,
                      timestamp-hash: timestamp-hash,
                      mint-timestamp: mint-ts,
                      owner: tx-sender,
                      status: true,
                      gps-verified: true,
                      oracle-verified: (get value verified)
                    }
                  )
                  (map-set batch-owners next-id tx-sender)
                  (map-set owner-batch-count tx-sender
                    (+ (get-owner-batch-count tx-sender) u1)
                  )
                  (var-set next-batch-id (+ next-id u1))
                  (print { event: "batch-minted", id: next-id })
                  (ok next-id)
                )
              (err ERR-INVALID-TIMESTAMP)
            )
          )
        (begin
          (map-set batches next-id
            {
              lat: lat,
              lon: lon,
              species: species,
              volume: volume,
              timestamp-hash: timestamp-hash,
              mint-timestamp: mint-ts,
              owner: tx-sender,
              status: true,
              gps-verified: false,
              oracle-verified: false
            }
          )
          (map-set batch-owners next-id tx-sender)
          (map-set owner-batch-count tx-sender
            (+ (get-owner-batch-count tx-sender) u1)
          )
          (var-set next-batch-id (+ next-id u1))
          (print { event: "batch-minted", id: next-id })
          (ok next-id)
        )
      )
    )
  )
)

(define-public (burn-batch (batch-id uint))
  (let (
        (batch (map-get? batches batch-id))
        (owner (map-get? batch-owners batch-id))
       )
    (match batch
      b
        (begin
          (asserts! (is-authorized-burner tx-sender (default-to tx-sender owner)) (err ERR-INVALID-BURNER))
          (asserts! (get status b) (err ERR-BATCH-NOT-FOUND))
          (map-set batches batch-id
            (merge b { status: false })
          )
          (map-delete batch-owners batch-id)
          (map-set owner-batch-count (get owner b)
            (- (get-owner-batch-count (get owner b)) u1)
          )
          (print { event: "batch-burned", id: batch-id })
          (ok true)
        )
      (err ERR-BATCH-NOT-FOUND)
    )
  )
)

(define-public (transfer-batch (batch-id uint) (new-owner principal))
  (let (
        (batch (map-get? batches batch-id))
        (current-owner (map-get? batch-owners batch-id))
       )
    (match batch
      b
        (begin
          (asserts! (is-eq tx-sender current-owner) (err ERR-NOT-AUTHORIZED))
          (asserts! (get status b) (err ERR-BATCH-NOT-FOUND))
          (map-set batches batch-id
            (merge b { owner: new-owner })
          )
          (map-set batch-owners batch-id new-owner)
          (map-set owner-batch-count current-owner
            (- (get-owner-batch-count current-owner) u1)
          )
          (map-set owner-batch-count new-owner
            (+ (get-owner-batch-count new-owner) u1)
          )
          (print { event: "batch-transferred", id: batch-id, to: new-owner })
          (ok true)
        )
      (err ERR-BATCH-NOT-FOUND)
    )
  )
)

(define-read-only (get-batch-count)
  (ok (var-get next-batch-id))
)