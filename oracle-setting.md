# 1. 오라클 19C 설치 후 초기 user 생성

## 🔧 Step 1. 관리자 계정으로 접속

```text
user: system
password: orcl
```


## 🔧 Step 2. PDB로 접속 확인 (중요)
```sql
SHOW CON_NAME;
```

👉 결과가 `ORCLPDB` 또는 `ORCLPDB1` 이어야 정상

* `CDB$ROOT` → **공통 사용자(Common User)**만 생성 가능 → 반드시 `C##` prefix 필요
* `ORCLPDB` → **로컬 사용자(Local User)** 생성 가능 → `C##` 없이 생성 가능

### 1. 현재 PDB 확인
```sql
SHOW PDBS;
```
예를 들어 결과에 `ORCLPDB` 같은 게 있을 겁니다.

### 2. PDB로 컨테이너 변경
```sql
ALTER SESSION SET CONTAINER = ORCLPDB;
```


## 🔧 Step 3. 유저 생성
```sql
CREATE USER ifcAdmin IDENTIFIED BY 123456;
```


## 🔧 Step 4. 권한 부여
```sql
GRANT CONNECT, RESOURCE TO ifcAdmin;
GRANT UNLIMITED TABLESPACE TO ifcAdmin;
```


## 🔧 Step 5. Connection 생성
접속 타입: Basic
항목           값
Hostname      localhost
Port          1521
Service name  ORCLPDB ✅

👉 SID가 아니라 반드시 Service Name 사용

잘못된 예 (주의)
Service name: ORCL ❌ → CDB로 접속됨
SID 사용 ❌ → PDB 접속 안 될 가능성 큼


## 참고 (비추천 방법)

CDB에서 강제로 `C##` 없이 만들려면:
```sql
ALTER SESSION SET "_ORACLE_SCRIPT"=true;
CREATE USER myuser IDENTIFIED BY mypassword;
```

하지만 이건:
* 내부용 hidden parameter
* 추후 문제 발생 가능
* 운영 환경에서는 **절대 비추천**
