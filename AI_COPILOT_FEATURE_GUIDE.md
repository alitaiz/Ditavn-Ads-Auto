# Hướng dẫn Tích hợp AI Co-Pilot: Trợ lý Chiến lược PPC

## 1. Mục tiêu

Tài liệu này mô tả kiến trúc và kế hoạch triển khai cho **AI Co-Pilot**, một tính năng chat tương tác được tích hợp sâu vào ứng dụng. Mục tiêu là cung cấp cho người dùng một trợ lý ảo thông minh, có khả năng trả lời các câu hỏi kinh doanh phức tạp bằng cách tự động truy cập, phân tích dữ liệu từ database PostgreSQL và các API của Amazon.

Thay vì phải tự lọc và phân tích dữ liệu thủ công, người dùng có thể đặt câu hỏi bằng ngôn ngữ tự nhiên, ví dụ:
- "Phân tích hiệu suất của ASIN B0DD45VPSL trong 30 ngày qua và đề xuất một rule điều chỉnh bid."
- "Lợi nhuận của tôi cho sản phẩm giá 27, giá vốn 7, phí FBA 7 là bao nhiêu? ACoS hòa vốn là gì?"
- "TACOS của sản phẩm B0DD45VPSL trong 30 ngày qua là bao nhiêu?"
- "Tạo cho tôi một kế hoạch khởi chạy PPC cho sản phẩm mới là ghế tre phòng tắm."

## 2. Tổng quan Kiến trúc

Giải pháp sẽ được xây dựng dựa trên mô hình Agent, sử dụng Google Gemini làm bộ não xử lý và LangChain làm framework để kết nối AI với các công cụ bên ngoài.

-   **Frontend:** Một tab "AI Assistant" mới sẽ được thêm vào trang "Automation", sử dụng một component React (`AIRuleSuggester.tsx`) để cung cấp giao diện chat.
-   **Backend:** Một router mới (`/api/ai/...`) sẽ được tạo để xử lý các yêu cầu chat. Router này sẽ giao tiếp với một service `Agent` chuyên dụng.
-   **AI Model:** Sử dụng **Google Gemini (`gemini-2.5-flash`)** thông qua thư viện `@google/genai` và `@langchain/google-genai` vì khả năng function calling và suy luận mạnh mẽ.
-   **LangChain Agent (ReAct):** Backend sẽ sử dụng một agent theo mô hình ReAct (Reasoning and Acting). Agent này có thể suy luận về một vấn đề, quyết định cần công cụ nào, thực thi công cụ đó, quan sát kết quả, và lặp lại cho đến khi có câu trả lời cuối cùng.
-   **Conversation State:** Lịch sử trò chuyện sẽ được quản lý ở backend để AI có thể hiểu được ngữ cảnh của các câu hỏi tiếp theo.

### Các Công cụ (Tools) được cung cấp cho AI

Đây là phần cốt lõi, cho phép AI tương tác với thế giới bên ngoài.
1.  **`get_product_performance` (Dữ liệu Quảng cáo):**
    -   **Chức năng:** Truy vấn database PostgreSQL để lấy dữ liệu hiệu suất **từ quảng cáo** (impressions, clicks, spend, sales, orders) cho một ASIN cụ thể trong một khoảng thời gian.
    -   **Nguồn Dữ liệu Hybrid (Quan trọng):** Công cụ này giải quyết vấn đề độ trễ dữ liệu một cách thông minh để đảm bảo không bao giờ tính trùng dữ liệu.
        1.  **Xác định Ngày Cắt (Cutoff Date):** Logic sẽ tự động xác định ngày cắt là **3 ngày trước ngày hôm nay**. Đây là ngày cuối cùng mà dữ liệu báo cáo được coi là đã hoàn chỉnh.
        2.  **Truy vấn Dữ liệu Lịch sử:** Công cụ sẽ truy vấn dữ liệu đã "chốt sổ" từ bảng `sponsored_products_search_term_report` cho khoảng thời gian **từ ngày bắt đầu cho đến ngày cắt**.
        3.  **Truy vấn Dữ liệu Stream:** Công cụ sẽ truy vấn dữ liệu gần thời gian thực từ bảng `raw_stream_events` cho khoảng thời gian **chỉ trong 2 ngày gần nhất** (hôm qua và hôm nay) để lấp đầy khoảng trống.
2.  **`get_total_sales_and_traffic` (MỚI - Dữ liệu Tổng thể):**
    -   **Chức năng:** Truy vấn bảng `sales_and_traffic_by_asin` để lấy dữ liệu kinh doanh **tổng thể**, bao gồm cả doanh số tự nhiên (organic).
    -   **Tại sao quan trọng?:** Công cụ này cho phép AI tính toán các chỉ số chiến lược như **TACOS (Total ACoS)** và đánh giá tác động của quảng cáo lên doanh số organic, cung cấp một cái nhìn toàn diện về sức khỏe của sản phẩm.
3.  **`calculate_profit_metrics`**:
    -   **Chức năng:** Một công cụ tính toán đơn giản, nhận đầu vào là giá bán, giá vốn, các chi phí và trả về lợi nhuận, biên lợi nhuận, và ACoS hòa vốn.
4.  **`create_ppc_launch_plan`** (Dành cho sản phẩm mới):
    -   **Chức năng:** Dựa trên mô tả về sản phẩm, đối thủ, và mục tiêu, công cụ này sẽ yêu cầu AI xây dựng một "playbook" (kế hoạch chi tiết) cho việc khởi chạy quảng cáo.

## 3. Luồng Hoạt động (User Flow)

1.  Người dùng mở tab "AI Assistant".
2.  Người dùng điền thông tin vào form và đặt câu hỏi đầu tiên.
3.  Frontend gửi yêu cầu đến endpoint `/api/ai/suggest-rule`.
4.  Backend khởi tạo một `Agent` mới.
5.  Backend gửi câu hỏi của người dùng và định nghĩa công cụ đến Gemini.
6.  **Vòng lặp Suy luận-Hành động của Agent:**
    -   **Suy luận (Thought):** Gemini phân tích câu hỏi. Ví dụ: "Để tính TACOS, tôi cần tổng chi tiêu quảng cáo và tổng doanh thu. Tôi sẽ dùng `get_product_performance` để lấy chi tiêu và `get_total_sales_and_traffic` để lấy tổng doanh thu."
    -   **Hành động (Action):** Gemini quyết định gọi các công cụ cần thiết.
    -   **Thực thi:** Backend nhận lệnh, chạy các hàm tương ứng và truy vấn database.
    -   **Quan sát (Observation):** Gemini nhận kết quả đã được tổng hợp.
    -   **Suy luận tiếp:** Gemini tiếp tục quá trình suy luận dựa trên dữ liệu đầy đủ.
7.  Khi có đủ thông tin, Gemini sẽ tạo ra câu trả lời cuối cùng.
8.  Backend stream toàn bộ quá trình về cho frontend, giúp người dùng hiểu được AI đang làm gì.

## 4. Bảo mật

-   **Database Tool:** Các công cụ truy vấn database được thiết kế để **chỉ chạy các câu lệnh `SELECT` đã được định sẵn** với các tham số hóa. AI không thể tự viết hay thực thi các câu lệnh SQL tùy ý, ngăn chặn hoàn toàn nguy cơ SQL injection.
-   **Prompt Injection:** System prompt được thiết kế cẩn thận để định rõ vai trò và giới hạn của AI, giảm thiểu rủi ro bị người dùng lợi dụng.

## 5. Các bước Triển khai

1.  **Backend:**
    -   Tạo router mới `backend/routes/ai.js`.
    -   Tích hợp các thư viện `@google/genai` và LangChain.
    -   Xây dựng `Agent Service` và triển khai các hàm cho từng công cụ.
2.  **Frontend:**
    -   Tạo component mới `views/components/AIRuleSuggester.tsx` cho giao diện chat.
    -   Cập nhật `views/AutomationView.tsx` để thêm tab "AI Assistant".
3.  **Server:**
    -   Cập nhật `backend/server.js` để đăng ký router mới.
    -   Đảm bảo `GEMINI_API_KEY` được thêm vào file `.env`.