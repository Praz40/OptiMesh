if(NOT EXISTS "${CMAKE_CURRENT_LIST_DIR}/../include/config.local.h")
    message(FATAL_ERROR "Copy include/config.example.h to include/config.local.h and configure the device first.")
endif()
idf_component_register(SRCS "main.c" "telemetry.c"
    INCLUDE_DIRS "." "../include"
    REQUIRES esp_wifi esp_event esp_netif esp_timer nvs_flash mqtt lwip)
